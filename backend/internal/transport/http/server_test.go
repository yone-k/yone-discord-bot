package httptransport

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuthorizationPrecedesBusinessAccess(t *testing.T) {
	for _, header := range []string{"", "Bearer wrong", "Basic test-token", "Bearer test-token extra"} {
		t.Run(header, func(t *testing.T) {
			calls := 0
			h, err := NewHandler(Config{Token: "test-token", Check: func(context.Context) error { return nil }, Routes: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ })})
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodPost, "/v1/notifications/poll", nil)
			r.Header.Set("Authorization", header)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 401 || calls != 0 {
				t.Fatalf("status=%d, business calls=%d", w.Code, calls)
			}
			if strings.Contains(w.Body.String(), "test-token") {
				t.Fatal("credential leaked")
			}
		})
	}
}

func TestHealthReflectsDatabaseOnEveryRequest(t *testing.T) {
	available := true
	h, err := NewHandler(Config{Token: "test-token", Check: func(context.Context) error {
		if !available {
			return errors.New("postgres://private:secret@host/db")
		}
		return nil
	}, Routes: http.NotFoundHandler()})
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []bool{true, false, true} {
		available = state
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
		want := 200
		if !state {
			want = 503
		}
		if w.Code != want {
			t.Fatalf("state=%v: status=%d", state, w.Code)
		}
		if strings.Contains(w.Body.String(), "private") || strings.Contains(w.Body.String(), "secret") {
			t.Fatal("health leaked database configuration")
		}
	}
}

func TestRequestDeadlinePropagatesToBusinessContext(t *testing.T) {
	for _, budget := range []string{"", "2000", "5000"} {
		t.Run(budget, func(t *testing.T) {
			called := false
			h, _ := NewHandler(Config{Token: "test-token", Check: func(context.Context) error { return nil }, Routes: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				deadline, ok := r.Context().Deadline()
				if !ok {
					t.Fatal("missing deadline")
				}
				max := 5 * time.Second
				if budget == "2000" {
					max = 2 * time.Second
				}
				remaining := time.Until(deadline)
				if remaining <= 0 || remaining > max {
					t.Fatalf("deadline remaining=%s", remaining)
				}
				w.WriteHeader(204)
			})})
			r := httptest.NewRequest(http.MethodPost, "/v1/test", nil)
			r.Header.Set("Authorization", "Bearer test-token")
			if budget != "" {
				r.Header.Set("X-Core-Timeout-Ms", budget)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if !called || w.Code != 204 {
				t.Fatalf("called=%v status=%d", called, w.Code)
			}
		})
	}
}

func TestInvalidDeadlineNeverInvokesBusinessHandler(t *testing.T) {
	for _, budget := range []string{"0", "-1", "5001", "2.5", "unknown"} {
		h, _ := NewHandler(Config{Token: "test-token", Check: func(context.Context) error { return nil }, Routes: http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("business handler called") })})
		r := httptest.NewRequest(http.MethodPost, "/v1/test", nil)
		r.Header.Set("Authorization", "Bearer test-token")
		r.Header.Set("X-Core-Timeout-Ms", budget)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("budget %s: status=%d", budget, w.Code)
		}
	}
}

func TestMissingServerConfigurationIsRejected(t *testing.T) {
	for _, cfg := range []Config{{}, {Token: "test-token"}, {Token: "test-token", Check: func(context.Context) error { return nil }}} {
		if _, err := NewHandler(cfg); err == nil {
			t.Fatal("accepted incomplete configuration")
		}
	}
}
