// Package dbtest admits destructive integration tests only to the explicitly
// identified local PostgreSQL container. Every physical connection is checked.
package dbtest

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func Open(t testing.TB) *sql.DB {
	t.Helper()
	raw, id := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_DB_CONTAINER_ID")
	if raw == "" || id == "" {
		t.Fatal("TEST_DATABASE_URL and TEST_DB_CONTAINER_ID are required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal("invalid TEST_DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	running, err := exec.CommandContext(ctx, "docker", "inspect", "--format", "{{.State.Running}}", id).Output()
	if err != nil || strings.TrimSpace(string(running)) != "true" {
		t.Fatal("test container is not running")
	}
	identifier, err := exec.CommandContext(ctx, "docker", "exec", id, "psql", "-X", "-At", "-U", u.User.Username(), "-d", strings.TrimPrefix(u.Path, "/"), "-c", "SELECT system_identifier::text FROM pg_control_system()").Output()
	if err != nil {
		t.Fatal("cannot identify test container cluster")
	}
	expected := strings.TrimSpace(string(identifier))
	if expected == "" {
		t.Fatal("empty cluster identity")
	}
	config, err := pgx.ParseConfig(raw)
	if err != nil {
		t.Fatal("invalid test database configuration")
	}
	config.ConnectTimeout = 5 * time.Second
	config.RuntimeParams["timezone"] = "UTC"
	db := stdlib.OpenDB(*config, stdlib.OptionAfterConnect(func(ctx context.Context, c *pgx.Conn) error {
		var identity string
		var version int
		if err := c.QueryRow(ctx, "SELECT system_identifier::text,current_setting('server_version_num')::int FROM pg_control_system()").Scan(&identity, &version); err != nil {
			return err
		}
		if identity != expected || version/10000 != 18 {
			return fmt.Errorf("test database cluster identity or PostgreSQL version mismatch")
		}
		return nil
	}))
	t.Cleanup(func() { _ = db.Close() })
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("test database unavailable or unsafe: %v", err)
	}
	return db
}

func Reset(t testing.TB, db *sql.DB) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, "DROP SCHEMA public CASCADE; CREATE SCHEMA public"); err != nil {
		t.Fatal(err)
	}
}
