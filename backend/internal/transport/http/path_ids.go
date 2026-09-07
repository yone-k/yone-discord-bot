package httptransport

import (
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

// Decode after routing but before generated parameter binding. Encoded IDs must
// remain a single URL segment until the router has matched the operation.
type pathIDMux struct{ *http.ServeMux }

func (m pathIDMux) HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request)) {
	m.ServeMux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		for _, name := range []string{"channelId", "id", "jobId", "targetId"} {
			value := r.PathValue(name)
			if !strings.HasPrefix(value, "~") {
				continue
			}
			decoded, err := base64.RawURLEncoding.Strict().DecodeString(value[1:])
			if err != nil || len(decoded) == 0 || !utf8.Valid(decoded) || strings.ContainsRune(string(decoded), 0) {
				writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
				return
			}
			// oapi-codegen's simple path binder performs PathUnescape itself.
			// Preserve literal percent sequences through that final binding step.
			r.SetPathValue(name, url.PathEscape(string(decoded)))
		}
		handler(w, r)
	})
}
