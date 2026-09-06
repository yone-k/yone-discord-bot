package repository

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestConstraintErrorsBecomeBusinessErrors(t *testing.T) {
	for _, tc := range []struct{ sql, code string }{{"23503", "referenced"}, {"23505", "conflict"}, {"23514", "invalid_input"}, {"40P01", "conflict"}} {
		t.Run(tc.sql, func(t *testing.T) {
			var got *domain.Error
			if !errors.As(mapError(&pgconn.PgError{Code: tc.sql}), &got) || string(got.Code) != tc.code {
				t.Fatalf("wrong business error: %v", got)
			}
		})
	}
}
