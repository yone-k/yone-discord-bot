package httptransport

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

// ValidateRoutes enforces the generated contract before any business operation.
// Authentication is performed by NewHandler before this middleware is entered.
func ValidateRoutes(next http.Handler) (http.Handler, error) {
	spec, err := api.GetSwagger()
	if err != nil {
		return nil, err
	}
	router, err := legacy.NewRouter(spec)
	if err != nil {
		return nil, err
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		route, params, err := router.FindRoute(r)
		if err != nil {
			writeJSON(w, 404, api.ApiError{Code: api.ApiErrorCodeNotFound})
			return
		}
		if r.Body != nil {
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20))
			if err != nil || (len(body) > 0 && !json.Valid(body)) {
				writeJSON(w, 400, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
		}
		err = openapi3filter.ValidateRequest(r.Context(), &openapi3filter.RequestValidationInput{
			Request: r, PathParams: params, Route: route,
			Options: &openapi3filter.Options{AuthenticationFunc: openapi3filter.NoopAuthenticationFunc, SkipSettingDefaults: true},
		})
		if err != nil {
			status := http.StatusBadRequest
			response := api.ApiError{Code: api.ApiErrorCodeInvalidInput}
			// Nullable/allOf schemas wrap the field error. Classify the underlying
			// rule without returning library messages or rejected input values.
			for cause := err; cause != nil; {
				var schemaError *openapi3.SchemaError
				if !errors.As(cause, &schemaError) {
					break
				}
				switch schemaError.SchemaField {
				case "pattern", "minimum", "maximum", "minLength", "maxLength", "enum", "format":
					status = http.StatusUnprocessableEntity
				}
				if schemaError.Schema == spec.Components.Schemas["Quantity"].Value && schemaError.SchemaField == "pattern" {
					target := "quantity"
					response.Target = &target
				}
				cause = schemaError.Origin
			}
			writeJSON(w, status, response)
			return
		}
		next.ServeHTTP(w, r)
	}), nil
}
