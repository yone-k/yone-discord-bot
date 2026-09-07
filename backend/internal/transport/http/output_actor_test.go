package httptransport

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

func TestOutputActorHeadersReachHandlerContextAndRejectAmbiguity(t *testing.T) {
	for _, scenario := range []string{"valid", "missing kind", "duplicate actor", "invalid actor", "background", "missing actor"} {
		t.Run(scenario, func(t *testing.T) {
			called := false
			handler := withOutputActorHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				op, present := application.OutputOperationFromContext(r.Context())
				if scenario == "valid" && (!present || op.ActorID != "999" || op.Kind != "AddListModalHandler" || op.InteractionID != "888") {
					t.Fatal(op, present)
				}
				if scenario == "background" && present {
					t.Fatal("background assigned an actor")
				}
				w.WriteHeader(204)
			}))
			request := httptest.NewRequest("POST", "/v1/lists/100/save", nil)
			if scenario == "background" {
				request = httptest.NewRequest("POST", "/v1/notifications/poll", nil)
			}
			if scenario != "background" && scenario != "missing actor" {
				request.Header.Set("X-Actor-Id", "999")
				request.Header.Set("X-Operation-Kind", "AddListModalHandler")
				request.Header.Set("X-Interaction-Id", "888")
			}
			if scenario == "missing kind" {
				request.Header.Del("X-Operation-Kind")
			}
			if scenario == "duplicate actor" {
				request.Header.Add("X-Actor-Id", "998")
			}
			if scenario == "invalid actor" {
				request.Header.Set("X-Actor-Id", "user")
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			valid := scenario == "valid" || scenario == "background"
			if called != valid || (!valid && response.Code != 400) {
				t.Fatal(called, response.Code)
			}
		})
	}
}

func TestEveryBusinessPatchRequiresActor(t *testing.T) {
	for _, tc := range []struct {
		path, body string
		allowed    bool
	}{
		{"/v1/lists/100", `{"messageId":"200"}`, false},
		{"/v1/lists/100", `{"messageId":"200","listTitle":"changed"}`, false},
		{"/v1/lists/100", `{}`, false},
		{"/v1/reminders/100", `{"remindNoticeThreadId":"200"}`, false},
		{"/v1/reminders/100/tasks/task", `{"expectedRevision":"1","patch":{"messageId":"200"}}`, false},
		{"/v1/reminders/100/tasks/task", `{"expectedRevision":"1","patch":{"messageId":"200","title":"changed"}}`, false},
	} {
		t.Run(tc.path+tc.body, func(t *testing.T) {
			called := false
			handler := withOutputActorHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				body, err := io.ReadAll(r.Body)
				if err != nil || string(body) != tc.body {
					t.Fatal("middleware consumed or changed body", string(body), err)
				}
				w.WriteHeader(204)
			}))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("PATCH", tc.path, strings.NewReader(tc.body)))
			if called != tc.allowed {
				t.Fatal("incorrect metadata exemption", called, response.Code)
			}
		})
	}
}
