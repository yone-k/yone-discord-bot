package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
)

func run(ctx context.Context, args []string) error {
	check := len(args) == 1 && args[0] == "--check"
	if len(args) > 0 && !check {
		return errors.New("usage: db-migrate [--check]")
	}
	url := os.Getenv("DATABASE_ADMIN_URL")
	if url == "" {
		return errors.New("DATABASE_ADMIN_URL is required")
	}
	role := os.Getenv("DATABASE_BOT_ROLE")
	if !check && role == "" {
		return errors.New("DATABASE_BOT_ROLE is required")
	}
	config, err := pgx.ParseConfig(url)
	if err != nil {
		return errors.New("invalid DATABASE_ADMIN_URL")
	}
	config.ConnectTimeout = 5 * time.Second
	config.RuntimeParams["timezone"] = "UTC"
	var db *sql.DB = stdlib.OpenDB(*config)
	defer db.Close()
	directory := os.Getenv("MIGRATIONS_DIR")
	if directory == "" {
		directory = "db/migrations"
	}
	runner := migration.Runner{Directory: directory}
	if check {
		return runner.AssertSchema(ctx, db)
	}
	return runner.Apply(ctx, db, role)
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "schema operation failed:", err)
		os.Exit(1)
	}
}
