package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNegativeQuantitiesIdentifyTheFieldThroughContractValidation(t *testing.T) {
	for _, tc := range []struct{ path, body string }{
		{"/v1/inventories/123/items", `{"name":"rice","stock":"-1","category":null}`},
		{"/v1/reminders/123/tasks/task/inventory-settings", `{"expectedRevision":"1","items":[{"name":"rice","consume":"-1"}]}`},
		{"/v1/reminders/123/tasks/task/complete", `{"expectedRevision":"1","consumeOverrides":[{"name":"rice","consume":"-1"}]}`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			h, err := ValidateRoutes(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("invalid input reached application") }))
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Actor-Id", "999")
			r.Header.Set("X-Operation-Kind", "AddInventoryCommand")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			var payload struct{ Code, Target string }
			if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if w.Code != 422 || payload.Code != "invalid_input" || payload.Target != "quantity" {
				t.Fatalf("unhelpful quantity error: %d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestContractRejectsMalformedRequestsBeforeUseCase(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"broken JSON", `{`, 400},
		{"missing name", `{"stock":"0","category":null}`, 400},
		{"numeric quantity", `{"name":"rice","stock":0,"category":null}`, 400},
		{"null quantity", `{"name":"rice","stock":null,"category":null}`, 400},
		{"negative quantity", `{"name":"rice","stock":"-1","category":null}`, 422},
		{"multiple JSON values", `{"name":"rice","stock":"0","category":null} {}`, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			h, err := ValidateRoutes(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodPost, "/v1/inventories/123/items", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Actor-Id", "999")
			r.Header.Set("X-Operation-Kind", "AddInventoryCommand")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if called || w.Code != tc.status {
				t.Fatalf("called=%v status=%d body=%s", called, w.Code, w.Body.String())
			}
		})
	}
}

func TestContractPreservesExactDecimalInput(t *testing.T) {
	const body = `{"name":"rice","stock":"999999999999999999999999999999.0000000000000000001","category":null}`
	called := false
	h, err := ValidateRoutes(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) }))
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/v1/inventories/123/items", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Actor-Id", "999")
	r.Header.Set("X-Operation-Kind", "AddInventoryCommand")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if !called || w.Code != 204 {
		t.Fatalf("called=%v status=%d body=%s", called, w.Code, w.Body.String())
	}
}
