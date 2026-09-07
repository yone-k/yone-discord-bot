package httptransport

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

type OutputRuntimeState struct {
	Enabled bool
	Running func() bool
}

func NewBusinessRoutes(service *application.Service, check func(context.Context) error, logger *slog.Logger, output ...OutputRuntimeState) (http.Handler, error) {
	handler := &Handler{Service: service, Check: check}
	if len(output) > 0 {
		handler.OutputEnabled, handler.OutputWorkerRunning = output[0].Enabled, output[0].Running
	}
	strict := api.NewStrictHandlerWithOptions(handler, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
			writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			// Application handlers have returned, so their write transaction has
			// already committed or rolled back. Never classify a transport error
			// as a definitive business rejection.
			if recordsBusinessRejection(r) {
				if channel, decodeErr := url.PathUnescape(r.PathValue("channelId")); decodeErr == nil && channel != "" {
					if recordErr := service.RecordBusinessRejection(r.Context(), channel, err); recordErr != nil {
						logger.Error("Failed to record business rejection", "method", r.Method, "operation", r.Pattern)
					}
				}
			}
			writeFailure(w, err, logger.With("method", r.Method, "operation", r.Pattern))
		},
	})
	routes := api.HandlerWithOptions(strict, api.StdHTTPServerOptions{
		BaseRouter: pathIDMux{http.NewServeMux()},
		ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
			writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
		},
	})
	validated, err := ValidateRoutes(routes, func(r *http.Request, channel string, response api.ApiError) {
		// Validation runs before generated handlers and never mutates business
		// data. Persist its definitive rejection just like an Application error.
		if !recordsBusinessRejection(r) {
			return
		}
		target := ""
		if response.Target != nil {
			target = *response.Target
		}
		if err := service.RecordBusinessRejection(r.Context(), channel, domain.Fail(domain.CodeInvalidInput, target, "Invalid input")); err != nil {
			logger.Error("Failed to record input rejection", "method", r.Method)
		}
	})
	if err != nil {
		return nil, err
	}
	return withOutputActorHeaders(validated), nil
}

func recordsBusinessRejection(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return false
	}
	for _, prefix := range []string{"/v1/lists/", "/v1/inventories/", "/v1/reminders/", "/v1/outputs/initialize/", "/v1/outputs/redraw/", "/v1/outputs/card-view/"} {
		if strings.HasPrefix(r.URL.Path, prefix) {
			return true
		}
	}
	return false
}
