package httptransport

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

// Config connects readiness and application routes without making the HTTP
// boundary responsible for opening a database or applying migrations.
type Config struct {
	Token  string
	Check  func(context.Context) error
	Routes http.Handler
}

func NewHandler(cfg Config) (http.Handler, error) {
	if strings.TrimSpace(cfg.Token) == "" || cfg.Check == nil || cfg.Routes == nil {
		return nil, errors.New("API token, readiness check and routes are required")
	}
	expected := sha256.Sum256([]byte("Bearer " + cfg.Token))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/health" && r.Method == http.MethodGet {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			ready := cfg.Check(ctx) == nil
			status := http.StatusOK
			if !ready {
				status = http.StatusServiceUnavailable
			}
			writeJSON(w, status, api.Health{Ready: ready})
			return
		}
		provided := sha256.Sum256([]byte(r.Header.Get("Authorization")))
		if len(r.Header.Values("Authorization")) != 1 || subtle.ConstantTimeCompare(expected[:], provided[:]) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeJSON(w, http.StatusUnauthorized, api.ApiError{Code: api.ApiErrorCodeUnauthorized})
			return
		}
		budget := 5000
		if value := r.Header.Get("X-Core-Timeout-Ms"); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > 5000 {
				writeJSON(w, http.StatusBadRequest, api.ApiError{Code: api.ApiErrorCodeInvalidInput})
				return
			}
			budget = n
		}
		ctx, cancel := context.WithTimeout(r.Context(), time.Duration(budget)*time.Millisecond)
		defer cancel()
		cfg.Routes.ServeHTTP(w, r.WithContext(ctx))
	}), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
