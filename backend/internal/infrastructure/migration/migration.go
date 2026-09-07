// Package migration applies the checked-in SQL; ent must never create or alter the schema.
package migration

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const ExpectedSchemaVersion = 3

type Migration struct {
	Version       int
	SQL, Checksum string
}
type Querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
type Runner struct{ Directory string }

// ReadinessError identifies the failed check independently of driver messages,
// which can contain connection credentials.
type ReadinessError struct {
	Stage string
	Err   error
}

func (e *ReadinessError) Error() string { return e.Stage + ": " + e.Err.Error() }
func (e *ReadinessError) Unwrap() error { return e.Err }

func Load(directory string) ([]Migration, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}
	pattern := regexp.MustCompile(`^(\d+)_.+\.sql$`)
	var result []Migration
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		match := pattern.FindStringSubmatch(e.Name())
		if match == nil {
			continue
		}
		v, err := strconv.Atoi(match[1])
		if err != nil {
			return nil, err
		}
		b, err := os.ReadFile(filepath.Join(directory, e.Name()))
		if err != nil {
			return nil, err
		}
		result = append(result, Migration{v, string(b), fmt.Sprintf("%x", sha256.Sum256(b))})
	}
	if len(result) != ExpectedSchemaVersion {
		return nil, errors.New("migration files do not match expected schema version")
	}
	for i, m := range result {
		if m.Version != i+1 {
			return nil, errors.New("migration files do not match expected schema version")
		}
	}
	return result, nil
}
func (r Runner) expected() ([]Migration, error) { return Load(r.Directory) }
func postgres18(ctx context.Context, q Querier) error {
	var version int
	if err := q.QueryRowContext(ctx, "SHOW server_version_num").Scan(&version); err != nil {
		return err
	}
	if version/10000 != 18 {
		return errors.New("PostgreSQL 18 is required")
	}
	return nil
}
func history(ctx context.Context, q Querier) ([]Migration, error) {
	rows, err := q.QueryContext(ctx, "SELECT version,checksum FROM schema_migrations ORDER BY version")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Migration
	for rows.Next() {
		var m Migration
		if err := rows.Scan(&m.Version, &m.Checksum); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}
func validate(applied, expected []Migration) error {
	if len(applied) > len(expected) {
		return errors.New("unexpected database schema version")
	}
	for i, m := range applied {
		if m.Version != i+1 {
			return errors.New("unexpected database schema version")
		}
		if m.Checksum != expected[i].Checksum {
			return errors.New("schema migration checksum mismatch")
		}
	}
	return nil
}
func (r Runner) AssertSchema(ctx context.Context, q Querier) error {
	if err := postgres18(ctx, q); err != nil {
		return &ReadinessError{Stage: "postgres_version", Err: err}
	}
	expected, err := r.expected()
	if err != nil {
		return &ReadinessError{Stage: "migration_files", Err: err}
	}
	applied, err := history(ctx, q)
	if err != nil {
		return &ReadinessError{Stage: "schema_history", Err: err}
	}
	if err := validate(applied, expected); err != nil {
		return &ReadinessError{Stage: "schema_checksum", Err: err}
	}
	if len(applied) != ExpectedSchemaVersion {
		return &ReadinessError{Stage: "schema_version", Err: errors.New("unexpected database schema version")}
	}
	return nil
}
func (r Runner) AssertReady(ctx context.Context, q Querier) error {
	if err := r.AssertSchema(ctx, q); err != nil {
		return err
	}
	var n int
	if err := q.QueryRowContext(ctx, "SELECT count(*) FROM data_imports WHERE singleton").Scan(&n); err != nil {
		return &ReadinessError{Stage: "import_marker", Err: err}
	}
	if n != 1 {
		return &ReadinessError{Stage: "import_marker", Err: errors.New("data import is not complete")}
	}
	return nil
}
func (r Runner) Apply(ctx context.Context, db *sql.DB, role string) error {
	expected, err := r.expected()
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := postgres18(ctx, tx); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(36001)"); err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, "SELECT to_regclass('public.schema_migrations') IS NOT NULL").Scan(&exists); err != nil {
		return err
	}
	var applied []Migration
	if exists {
		applied, err = history(ctx, tx)
		if err != nil {
			return err
		}
	}
	if err := validate(applied, expected); err != nil {
		return err
	}
	for _, m := range expected[len(applied):] {
		if _, err := tx.ExecContext(ctx, m.SQL); err != nil {
			return fmt.Errorf("migration %d: %w", m.Version, err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", m.Version, m.Checksum); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "REVOKE CREATE ON SCHEMA public FROM PUBLIC"); err != nil {
		return err
	}
	if role != "" {
		if err := GrantRuntimePermissions(ctx, tx, role); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func quote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }
func GrantRuntimePermissions(ctx context.Context, tx *sql.Tx, role string) error {
	var super, createDB, createRole bool
	if err := tx.QueryRowContext(ctx, "SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1", role).Scan(&super, &createDB, &createRole); err != nil {
		return errors.New("runtime role must exist without administration privileges")
	}
	if super || createDB || createRole {
		return errors.New("runtime role must exist without administration privileges")
	}
	checks := []struct{ sql, message string }{
		{"SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.relnamespace='public'::regnamespace AND r.rolname=$1)", "runtime role cannot be a schema table owner"},
		{"SELECT EXISTS(SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database() AND r.rolname=$1 UNION ALL SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='public' AND r.rolname=$1)", "runtime role cannot be a database or schema owner"},
		{"SELECT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1)", "runtime role must not inherit other roles"},
	}
	for _, c := range checks {
		var bad bool
		if err := tx.QueryRowContext(ctx, c.sql, role).Scan(&bad); err != nil {
			return err
		}
		if bad {
			return errors.New(c.message)
		}
	}
	var database string
	if err := tx.QueryRowContext(ctx, "SELECT current_database()").Scan(&database); err != nil {
		return err
	}
	r, d := quote(role), quote(database)
	for _, s := range []string{"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM " + r, "REVOKE ALL ON SCHEMA public FROM " + r, "REVOKE ALL ON DATABASE " + d + " FROM PUBLIC", "REVOKE ALL ON DATABASE " + d + " FROM " + r, "GRANT CONNECT ON DATABASE " + d + " TO " + r, "GRANT USAGE ON SCHEMA public TO " + r, "GRANT SELECT,INSERT,UPDATE,DELETE ON list_channels,inventory_channels,remind_channels,list_items,inventory_items,remind_tasks,remind_task_inventory_items,operation_records,output_tasks,output_dispatches,channel_output_suspensions,discord_card_views TO " + r, "GRANT USAGE ON SEQUENCE output_tasks_output_order_seq TO " + r, "GRANT SELECT ON schema_migrations,data_imports TO " + r} {
		if _, err := tx.ExecContext(ctx, s); err != nil {
			return err
		}
	}
	return nil
}
