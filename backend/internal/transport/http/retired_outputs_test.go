package httptransport

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRetiredOutputRoutesAreNotExposed(t *testing.T) {
	routes, err := NewBusinessRoutes(nil, nil, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []struct{ method, path string }{
		{http.MethodPost, "/v1/notifications/poll"},
		{http.MethodPost, "/v1/notifications/ack"},
		{http.MethodGet, "/v1/display/initialization"},
	} {
		t.Run(request.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			routes.ServeHTTP(response, httptest.NewRequest(request.method, request.path, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("retired route returned %d: %s", response.Code, response.Body.String())
			}
		})
	}
}
