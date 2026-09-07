package httptransport

import (
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
	"net/http"
	"strings"
)

// This boundary preserves the actor through generated handlers and their error
// callback. Required-header policy is declared separately by each API contract.
func withOutputActorHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actors, kinds, interactions := r.Header.Values("X-Actor-Id"), r.Header.Values("X-Operation-Kind"), r.Header.Values("X-Interaction-Id")
		if len(actors) == 0 && len(kinds) == 0 && len(interactions) == 0 {
			if requiresOutputActor(r) {
				writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if len(actors) != 1 || len(kinds) != 1 || len(interactions) > 1 {
			writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
			return
		}
		var interaction *string
		if len(interactions) == 1 {
			interaction = &interactions[0]
		}
		ctx, err := outputActorContext(r.Context(), actors[0], api.OutputOperationKind(kinds[0]), interaction)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
			return
		}
		if isAuxiliaryOutputCall(r, kinds[0]) {
			ctx = application.WithAuxiliaryOutputOperation(ctx)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func isAuxiliaryOutputCall(r *http.Request, operation string) bool {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if r.Method == http.MethodPost && len(parts) == 4 && parts[0] == "v1" && parts[1] == "inventories" && parts[3] == "resolve" {
		return operation == "AddRemindListCommand" || operation == "RemindTaskInventoryModalHandler"
	}
	if r.Method != http.MethodPut && r.Method != http.MethodPatch {
		return false
	}
	if len(parts) != 3 || parts[0] != "v1" {
		return false
	}
	switch parts[1] {
	case "lists":
		return operation == "InitListCommand"
	case "inventories":
		return operation == "InitInventoryCommand"
	case "reminders":
		return operation == "InitRemindListCommand" || operation == "RemindTaskAddModalHandler" || operation == "AddRemindListCommand"
	}
	return false
}

func requiresOutputActor(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return false
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "v1" {
		return false
	}
	return parts[1] == "outputs" || parts[1] == "lists" || parts[1] == "inventories" || parts[1] == "reminders"
}
