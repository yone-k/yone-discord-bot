package httptransport

import (
	"context"
	"database/sql/driver"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestShortageErrorIncludesExactAmounts(t *testing.T) {
	required, _ := domain.ParseQuantity("1.0000000000000000001")
	available, _ := domain.ParseQuantity("1")
	err := &application.OperationError{Cause: domain.Fail("shortage", "inventory", "Insufficient inventory"), Shortages: []domain.Shortage{{InventoryID: "legacy/item", Name: "rice", Required: required, Available: available}}}
	w := httptest.NewRecorder()
	writeFailure(w, err, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if w.Code != 409 || !strings.Contains(w.Body.String(), `"required":"1.0000000000000000001"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestBusinessErrorsHaveStableSafeStatus(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{domain.Fail("invalid_input", "stock", "private input details"), 422, "invalid_input"},
		{domain.Fail("not_found", "task", "private details"), 404, "not_found"},
		{domain.Fail("conflict", "revision", "private details"), 409, "conflict"},
		{domain.Fail("shortage", "stock", "private details"), 409, "shortage"},
		{domain.Fail("referenced", "task", "private details"), 409, "referenced"},
		{driver.ErrBadConn, 503, "unavailable"},
		{context.DeadlineExceeded, 503, "unavailable"},
		{&pgconn.PgError{Code: "57P01", Message: "private database"}, 503, "unavailable"},
		{errors.New("private credentials"), 500, "internal"},
	} {
		t.Run(tc.code, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeFailure(w, tc.err, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if w.Code != tc.status || !strings.Contains(w.Body.String(), `"code":"`+tc.code+`"`) {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "private") {
				t.Fatal("internal details leaked")
			}
		})
	}
}
