package httptransport

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

func NewBusinessRoutes(service *application.Service, check func(context.Context) error, logger *slog.Logger) (http.Handler, error) {
	strict := api.NewStrictHandlerWithOptions(&Handler{Service: service, Check: check}, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
			writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeFailure(w, err, logger.With("method", r.Method, "operation", r.Pattern))
		},
	})
	routes := api.HandlerWithOptions(strict, api.StdHTTPServerOptions{
		BaseRouter: pathIDMux{http.NewServeMux()},
		ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
			writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
		},
	})
	return ValidateRoutes(routes)
}
