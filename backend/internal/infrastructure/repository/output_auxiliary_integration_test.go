//go:build integration

package repository_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	httptransport "github.com/yone-k/yone-discord-bot/backend/internal/transport/http"
)

func TestReminderCommandInventoryResolutionPreservesPrimaryOperation(t *testing.T) {
	db, store := rpSetup(t)
	ctx := t.Context()
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutCatalog(ctx, &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "101", ListTitle: "stock"}, DefaultCategory: "other"}}); err != nil {
			return err
		}
		return r.PutRemindChannel(ctx, &domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "tasks"}, LinkedInventoryChannelID: rpPtr("101")})
	})
	service := application.New(store, fixedClock{time.Now().UTC()}, ids{})
	routes, err := httptransport.NewBusinessRoutes(service, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	call := func(path, body string) map[string]any {
		t.Helper()
		request := httptest.NewRequest("POST", path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Actor-Id", "999")
		request.Header.Set("X-Operation-Kind", "AddRemindListCommand")
		request.Header.Set("X-Interaction-Id", "888")
		response := httptest.NewRecorder()
		routes.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatal(path, response.Code, response.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	item := call("/v1/inventories/101/resolve", `{"name":"rice"}`)
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records WHERE interaction_id='888'").Scan(&count); err != nil || count != 0 {
		t.Fatal("resolution consumed primary outcome", count, err)
	}
	task := call("/v1/reminders/100/tasks", `{"title":"task","description":null,"intervalDays":1,"timeOfDay":"09:00","remindBeforeMinutes":0,"inventoryItems":[{"inventoryId":"`+item["id"].(string)+`","consume":"1"}]}`)
	if len(task["inventoryItems"].([]any)) != 1 {
		t.Fatal(task)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records WHERE interaction_id='888' AND channel_id='100' AND success").Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
}

func TestSchemaRejectionRecordsOutcomeWithoutMutatingInventory(t *testing.T) {
	for _, body := range []string{`{"expectedRevision":"0","items":[{"name":"rice","consume":"-1"}]}`, `{"items":`} {
		t.Run(body, func(t *testing.T) {
			db, store := rpSetup(t)
			ctx := t.Context()
			rpWrite(t, store, func(r application.Repository) error {
				return r.PutRemindChannel(ctx, &domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "tasks", OperationLogThreadID: rpPtr("200")}})
			})
			service := application.New(store, fixedClock{time.Now().UTC()}, ids{})
			routes, err := httptransport.NewBusinessRoutes(service, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err != nil {
				t.Fatal(err)
			}
			for range 2 {
				request := httptest.NewRequest("POST", "/v1/reminders/100/tasks/task/inventory-settings", strings.NewReader(body))
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("X-Actor-Id", "999")
				request.Header.Set("X-Operation-Kind", "RemindTaskInventoryModalHandler")
				request.Header.Set("X-Interaction-Id", "888")
				response := httptest.NewRecorder()
				routes.ServeHTTP(response, request)
				if response.Code != 400 && response.Code != 422 {
					t.Fatal(response.Code)
				}
			}
			var count int
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records WHERE interaction_id='888' AND NOT success").Scan(&count); err != nil || count != 1 {
				t.Fatal("rejection missing or duplicated", count, err)
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM output_tasks WHERE kind='operation_log'").Scan(&count); err != nil || count != 1 {
				t.Fatal("rejection log missing or duplicated", count, err)
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM inventory_items").Scan(&count); err != nil || count != 0 {
				t.Fatal("inventory mutated", count, err)
			}
		})
	}
}

func TestOutputSchemaRejectionRecordsOutcome(t *testing.T) {
	for _, operation := range []struct{ path, kind, body, contentType string }{
		{"/v1/outputs/initialize/100", "InitListCommand", `{"kind":"list","enableLog":"invalid"}`, "application/json"},
		{"/v1/outputs/redraw/100", "InitListButtonHandler", `{"kind":"list"}`, "text/plain"},
	} {
		t.Run(operation.kind, func(t *testing.T) {
			db, store := rpSetup(t)
			ctx := t.Context()
			rpWrite(t, store, func(r application.Repository) error {
				return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list", OperationLogThreadID: rpPtr("200")}, DefaultCategory: "other"}})
			})
			service := application.New(store, fixedClock{time.Now().UTC()}, ids{})
			routes, err := httptransport.NewBusinessRoutes(service, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err != nil {
				t.Fatal(err)
			}
			for range 2 {
				request := httptest.NewRequest("POST", operation.path, strings.NewReader(operation.body))
				request.Header.Set("Content-Type", operation.contentType)
				request.Header.Set("X-Actor-Id", "999")
				request.Header.Set("X-Operation-Kind", operation.kind)
				request.Header.Set("X-Interaction-Id", "888")
				response := httptest.NewRecorder()
				routes.ServeHTTP(response, request)
				if response.Code != 400 && response.Code != 422 {
					t.Fatal(response.Code, response.Body.String())
				}
			}
			var count int
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records WHERE interaction_id='888' AND NOT success").Scan(&count); err != nil || count != 1 {
				t.Fatal("rejection missing or duplicated", count, err)
			}
			// Initialization commands do not post logs; redraw buttons do.
			wantLogs := 0
			if operation.kind == "InitListButtonHandler" {
				wantLogs = 1
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM output_tasks WHERE kind='operation_log'").Scan(&count); err != nil || count != wantLogs {
				t.Fatal("rejection log policy not preserved", count, err)
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM output_tasks WHERE kind<>'operation_log'").Scan(&count); err != nil || count != 0 {
				t.Fatal("output initialized despite rejection", count, err)
			}
		})
	}
}

func TestAuxiliarySettingsDoNotConsumePrimaryOperation(t *testing.T) {
	for _, scenario := range []string{"success", "primary rejection", "auxiliary rejection"} {
		t.Run(scenario, func(t *testing.T) {
			db, store := rpSetup(t)
			ctx := t.Context()
			rpWrite(t, store, func(r application.Repository) error {
				return r.PutRemindChannel(ctx, &domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "tasks", OperationLogThreadID: rpPtr("200")}})
			})
			service := application.New(store, fixedClock{time.Now().UTC()}, ids{})
			routes, err := httptransport.NewBusinessRoutes(service, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err != nil {
				t.Fatal(err)
			}
			call := func(method, path, body string, status int) {
				t.Helper()
				request := httptest.NewRequest(method, path, strings.NewReader(body))
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("X-Actor-Id", "999")
				request.Header.Set("X-Operation-Kind", "RemindTaskAddModalHandler")
				request.Header.Set("X-Interaction-Id", "888")
				response := httptest.NewRecorder()
				routes.ServeHTTP(response, request)
				if response.Code != status {
					t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
				}
			}
			if scenario == "auxiliary rejection" {
				call("PUT", "/v1/reminders/100", `{"channelId":"100","listTitle":"tasks","linkedInventoryChannelId":"404"}`, 404)
			} else {
				call("PUT", "/v1/reminders/100", `{"channelId":"100","listTitle":"tasks","linkedInventoryChannelId":null}`, 200)
				var count int
				if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != 0 {
					t.Fatal("auxiliary success consumed the interaction", count, err)
				}
				items, status := `[]`, 200
				if scenario == "primary rejection" {
					items, status = `[{"inventoryId":"missing","consume":"1"}]`, 422
				}
				call("POST", "/v1/reminders/100/tasks", `{"title":"task","description":null,"intervalDays":1,"timeOfDay":"09:00","remindBeforeMinutes":0,"inventoryItems":`+items+`}`, status)
			}
			var count int
			var success bool
			if err := db.QueryRowContext(ctx, "SELECT count(*), bool_and(success) FROM operation_records WHERE interaction_id='888'").Scan(&count, &success); err != nil || count != 1 || success != (scenario == "success") {
				t.Fatal(count, success, err)
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM output_tasks WHERE kind='operation_log'").Scan(&count); err != nil || count != 1 {
				t.Fatal("primary log missing or duplicated", count, err)
			}
		})
	}
}
