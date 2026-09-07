package httptransport

import (
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEveryGeneratedWriteHasAnOperationPolicy(t *testing.T) {
	spec, err := api.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	for path, item := range spec.Paths.Map() {
		for method, operation := range item.Operations() {
			if method == "GET" || method == "HEAD" || operation.OperationID == "RecordOutputEvent" {
				continue
			}
			if _, ok := businessCallKinds[operation.OperationID]; !ok {
				t.Errorf("missing policy: %s %s %s", method, path, operation.OperationID)
			}
		}
	}
}

func TestOperationKindMustMatchTheBusinessCall(t *testing.T) {
	for _, tc := range []struct {
		kind, path, body string
		allowed          bool
	}{
		{"InventoryAddModalHandler", "/v1/inventories/100/items", `{"name":"rice","stock":"1","category":null}`, true},
		{"AddRemindListCommand", "/v1/inventories/100/resolve", `{"name":"rice"}`, true},
		{"AddListModalHandler", "/v1/inventories/100/items", `{"name":"rice","stock":"1","category":null}`, false},
		{"InventoryDeleteModalHandler", "/v1/inventories/100/items", `{"name":"rice","stock":"1","category":null}`, false},
		{"InitListCommand", "/v1/outputs/initialize/100", `{"kind":"list"}`, true},
		{"InitListCommand", "/v1/outputs/initialize/100", `{"kind":"inventory"}`, false},
		{"InventorySelectionCancelButtonHandler", "/v1/outputs/card-view/100/inventory/100", `{"mode":"normal","page":0}`, true},
		{"InventorySelectionCancelButtonHandler", "/v1/outputs/card-view/100/inventory/100", `{"mode":"delete_selection","page":0}`, false},
		{"RemindTaskUpdateButtonHandler", "/v1/outputs/card-view/100/inventory/100", `{"mode":"update_selection","page":0}`, false},
		{"InitInventoryCommand", "/v1/outputs/delete-all/100", ``, false},
	} {
		t.Run(tc.kind+tc.path+tc.body, func(t *testing.T) {
			called := false
			handler, err := ValidateRoutes(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { called = true; w.WriteHeader(204) }))
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", tc.path, strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Actor-Id", "999")
			request.Header.Set("X-Operation-Kind", tc.kind)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if called != tc.allowed || (!tc.allowed && response.Code != 400) {
				t.Fatalf("called=%v status=%d body=%s", called, response.Code, response.Body.String())
			}
		})
	}
}
