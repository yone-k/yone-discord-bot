package httptransport

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

func writeFailure(w http.ResponseWriter, err error, logger *slog.Logger) {
	status, response := http.StatusInternalServerError, api.ApiError{Code: api.ApiErrorCodeInternal}
	var business *domain.Error
	if errors.As(err, &business) {
		switch business.Code {
		case "invalid_input":
			status = http.StatusUnprocessableEntity
		case "not_found":
			status = http.StatusNotFound
		case "conflict", "shortage", "referenced":
			status = http.StatusConflict
		}
		if status != http.StatusInternalServerError {
			response.Code = api.ApiErrorCode(business.Code)
			if business.Reason == domain.ReasonDuplicateName {
				reason := api.ApiErrorReasonDuplicateName
				response.Reason = &reason
			}
			if business.Target != "" {
				response.Target = &business.Target
			}
		}
	} else if unavailable(err) {
		status = http.StatusServiceUnavailable
		response.Code = api.ApiErrorCodeUnavailable
	}
	var detail *application.OperationError
	if errors.As(err, &detail) && status < 500 {
		if len(detail.Shortages) > 0 {
			items := make([]api.Shortage, 0, len(detail.Shortages))
			for _, item := range detail.Shortages {
				items = append(items, mapShortage(item))
			}
			response.Shortages = &items
		}
		if len(detail.References) > 0 {
			items := make([]api.StoredRemindTask, 0, len(detail.References))
			for _, item := range detail.References {
				items = append(items, mapTask(item))
			}
			response.References = &items
		}
	}
	if status >= 500 {
		// Raw connection errors may contain a DSN. Log structured diagnostic
		// categories instead of copying driver messages or request credentials.
		var pg *pgconn.PgError
		attributes := []any{"error_type", fmt.Sprintf("%T", err)}
		if errors.As(err, &pg) {
			attributes = append(attributes, "sqlstate", pg.Code, "constraint", pg.ConstraintName)
		}
		logger.Error("Core API operation failed", attributes...)
	}
	writeJSON(w, status, response)
}

func unavailable(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || errors.Is(err, driver.ErrBadConn) || errors.Is(err, sql.ErrConnDone) {
		return true
	}
	var connection *pgconn.ConnectError
	if errors.As(err, &connection) {
		return true
	}
	var network net.Error
	if errors.As(err, &network) {
		return true
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return strings.HasPrefix(pg.Code, "08") || pg.Code == "57P01" || pg.Code == "57P02" || pg.Code == "57P03" || pg.Code == "53300"
	}
	return false
}
