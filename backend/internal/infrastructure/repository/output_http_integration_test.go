//go:build integration

package repository_test

import (
	"context"
	"encoding/base64"
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

func TestOutputHTTPRoutesUseStoredStateAndRequireActorHeaders(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutCatalog(ctx, &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "inventory"}, DefaultCategory: "その他"}})
	})
	service := application.New(store, fixedClock{now}, ids{})
	check := func(context.Context) error { return nil }
	routes, err := httptransport.NewBusinessRoutes(service, check, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	handler, err := httptransport.NewHandler(httptransport.Config{Token: "test-token", Check: check, Routes: routes})
	if err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string, actor bool, want int) map[string]any {
		t.Helper()
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer test-token")
		if body != "" {
			request.Header.Set("Content-Type", "application/json")
		}
		if actor {
			request.Header.Set("X-Actor-Id", "999")
			request.Header.Set("X-Operation-Kind", "InitInventoryCommand")
			if strings.Contains(path, "/card-view/") {
				request.Header.Set("X-Operation-Kind", "InventoryDeleteButtonHandler")
			}
			if strings.Contains(path, "/delete-all/") {
				request.Header.Set("X-Operation-Kind", "ConfirmationModalHandler")
			}
			if path == "/v1/outputs/operation-log-events" {
				request.Header.Set("X-Interaction-Id", "888")
			}
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
		}
		var decoded map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded
	}
	status := call("GET", "/v1/outputs/status", "", false, 200)
	if status["contract"] != application.OutputContract || status["workerRunning"] != false {
		t.Fatal(status)
	}
	call("POST", "/v1/outputs/initialize/100", `{"kind":"inventory"}`, false, 400)
	call("POST", "/v1/outputs/initialize/100", `{"kind":"inventory"}`, true, 200)
	view := call("POST", "/v1/outputs/card-view/100/inventory/~"+base64.RawURLEncoding.EncodeToString([]byte("100")), `{"mode":"delete_selection","page":0}`, true, 200)
	if view["targetId"] != "100" || view["mode"] != "delete_selection" {
		t.Fatal(view)
	}
	call("POST", "/v1/outputs/redraw/100", `{"kind":"inventory"}`, true, 200)
	job := call("POST", "/v1/outputs/delete-all/100", "", true, 200)
	stored := call("GET", "/v1/outputs/jobs/"+job["jobId"].(string), "", false, 200)
	if stored["confirmedDeletedCount"] != float64(0) || stored["firstAttemptFinished"] != false || stored["state"] != "pending" {
		t.Fatal(stored)
	}
	call("POST", "/v1/outputs/initialize/100", `{"kind":"inventory"}`, true, 409)
	status = call("GET", "/v1/outputs/status", "", false, 200)
	if len(status["suspensions"].([]any)) != 1 {
		t.Fatal(status)
	}
	call("POST", "/v1/outputs/operation-log-events", `{"actorId":"998","channelId":"100","operationKind":"InitInventoryCommand","interactionId":"888","occurredAt":"2026-09-01T00:00:00.000Z","success":false}`, true, 422)
	call("POST", "/v1/outputs/operation-log-events", `{"actorId":"999","channelId":"100","operationKind":"InitInventoryCommand","interactionId":"888","occurredAt":"2026-09-01T00:00:00.000Z","success":false}`, true, 200)
}
