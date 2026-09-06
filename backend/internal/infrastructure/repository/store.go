// Package repository maps domain aggregates to the SQL-owned schema through ent.
package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
)

type Store struct{ db *sql.DB }

func New(db *sql.DB) *Store { return &Store{db: db} }
func (s *Store) Read(ctx context.Context, fn func(application.Repository) error) error {
	return s.run(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}, fn)
}
func (s *Store) Write(ctx context.Context, fn func(application.Repository) error) error {
	return s.run(ctx, &sql.TxOptions{}, fn)
}
func (s *Store) run(ctx context.Context, options *sql.TxOptions, fn func(application.Repository) error) error {
	tx, err := s.db.BeginTx(ctx, options)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	client := ent.NewClient(ent.Driver(&transactionDriver{Conn: entsql.Conn{ExecQuerier: tx}}))
	r := &repository{tx: tx, client: client}
	if err = fn(r); err != nil {
		return mapError(err)
	}
	return mapError(tx.Commit())
}

type repository struct {
	tx     *sql.Tx
	client *ent.Client
}

// ent's update builders open a transaction internally. Reuse the outer unit
// of work without allowing an individual builder to commit or roll it back.
type transactionDriver struct{ entsql.Conn }

func (d *transactionDriver) Tx(context.Context) (dialect.Tx, error) { return dialect.NopTx(d), nil }
func (*transactionDriver) Dialect() string                          { return dialect.Postgres }
func (*transactionDriver) Close() error                             { return nil }

func utcPtr(v *time.Time) *time.Time {
	if v == nil {
		return nil
	}
	utc := v.UTC()
	return &utc
}

// Clear and Set must be mutually exclusive: ent otherwise emits duplicate
// assignments for the same SQL column.
func setNullable[T, B any](value *T, set func(T) B, clear func() B) {
	if value == nil {
		clear()
	} else {
		set(*value)
	}
}

func mapError(err error) error {
	if err == nil {
		return nil
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23001", "23503":
			return domain.Fail("referenced", pg.ConstraintName, "A referenced record prevents this operation")
		case "23505":
			return domain.Fail("conflict", pg.ConstraintName, "A unique value already exists")
		case "23514", "23502", "22007", "22008", "22P02", "22003":
			return domain.Fail("invalid_input", pg.ConstraintName, "The value violates a data constraint")
		case "40001", "40P01":
			return domain.Fail("conflict", "transaction", "Concurrent changes prevented this operation")
		}
	}
	return err
}

// table comes only from the fixed repository methods, never from HTTP input.
func (r *repository) lockChannel(ctx context.Context, table, id string) error {
	if _, err := r.tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,36))", table+":"+id); err != nil {
		return err
	}
	rows, err := r.tx.QueryContext(ctx, "SELECT channel_id FROM "+table+" WHERE channel_id=$1 FOR UPDATE", id)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var channelID string
		if err := rows.Scan(&channelID); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (r *repository) lockItems(ctx context.Context, table, channel string) error {
	rows, err := r.tx.QueryContext(ctx, "SELECT id FROM "+table+" WHERE channel_id=$1 ORDER BY id FOR UPDATE", channel)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
	}
	return rows.Err()
}
