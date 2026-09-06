package main

import (
	"errors"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type config struct {
	Database   *pgx.ConnConfig
	Token      string
	Migrations string
}

func loadConfig() (config, error) {
	var result config
	raw := os.Getenv("DATABASE_URL")
	result.Token = os.Getenv("CORE_API_TOKEN")
	if raw == "" {
		return result, errors.New("DATABASE_URL is required")
	}
	if strings.TrimSpace(result.Token) == "" {
		return result, errors.New("CORE_API_TOKEN is required")
	}
	database, err := pgx.ParseConfig(raw)
	if err != nil {
		return result, errors.New("invalid DATABASE_URL")
	}
	database.ConnectTimeout = 5 * time.Second
	database.RuntimeParams["timezone"] = "UTC"
	result.Database = database
	result.Migrations = os.Getenv("MIGRATIONS_DIR")
	if result.Migrations == "" {
		result.Migrations = "db/migrations"
	}
	return result, nil
}
