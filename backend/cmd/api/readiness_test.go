package main

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
)

func TestStartupReadinessDiagnosticIdentifiesCauseWithoutDriverMessage(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{"schema", &migration.ReadinessError{Stage: "schema_history", Err: errors.New("private-credential")}, "stage=schema_history"},
		{"postgres", &pgconn.PgError{Code: "42501", Message: "private-credential"}, "sqlstate=42501"},
		{"wrapped postgres", fmt.Errorf("private-credential: %w", &pgconn.PgError{Code: "42P01"}), "sqlstate=42P01"},
		{"unknown", errors.New("postgres://private-credential@host/db"), "error_type=*errors.errorString"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := readinessDiagnostic(tc.err).Error()
			if !strings.Contains(got, tc.want) || strings.Contains(got, "private-credential") {
				t.Fatalf("unexpected diagnostic: %s", got)
			}
		})
	}
}
