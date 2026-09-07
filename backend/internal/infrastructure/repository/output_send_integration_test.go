//go:build integration

package repository_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/discord"
)

func TestOperationLogExecutionCommitsBeforeHTTPAndHoldsUnknownResult(t *testing.T) {
	for _, name := range []string{"success", "lost response", "result save failure", "wrong author", "wrong nonce"} {
		lost := name != "success"
		t.Run(name, func(t *testing.T) {
			db, store := rpSetup(t)
			ctx, now := t.Context(), time.Date(2026, 1, 5, 3, 4, 5, 0, time.UTC)
			s := application.New(store, fixedClock{now}, ids{})
			op := application.OperationRecord{ID: rpID(), ChannelID: "100", ActorID: "123", Kind: "AddListModalHandler", Success: true, OccurredAt: now}
			job := queuedOutput("100", application.OutputOperationLog, now)
			job.OperationID, job.TargetID = op.ID, op.ID
			job.Payload.DestinationID = "200"
			rpWrite(t, store, func(r application.Repository) error {
				if _, err := r.PutOperation(ctx, op); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, job)
				return err
			})
			if _, err := s.ClaimOutput(ctx, "leader"); err != nil {
				t.Fatal(err)
			}
			if name == "result save failure" {
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_output_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.outcome='succeeded' THEN RAISE EXCEPTION 'injected result save failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_output_result BEFORE UPDATE ON output_dispatches FOR EACH ROW EXECUTE FUNCTION reject_output_result()`); err != nil {
					t.Fatal(err)
				}
			}
			var posts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if req.Method == http.MethodGet && req.URL.Path == "/channels/200" {
					_, _ = w.Write([]byte(`{"id":"200","parent_id":"100","owner_id":"999","thread_metadata":{"archived":false}}`))
					return
				}
				if req.Method != http.MethodPost || req.URL.Path != "/channels/200/messages" {
					t.Errorf("unexpected request %s %s", req.Method, req.URL.Path)
					w.WriteHeader(400)
					return
				}
				posts.Add(1)
				var payload struct {
					Content, Nonce string
					EnforceNonce   bool `json:"enforce_nonce"`
				}
				if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				var storedNonce string
				if err := db.QueryRowContext(ctx, "SELECT nonce FROM output_dispatches WHERE task_id=$1 AND outcome='unknown'", job.ID).Scan(&storedNonce); err != nil {
					t.Error("dispatch not committed before HTTP", err)
				}
				if storedNonce != payload.Nonce || len(payload.Nonce) != 22 || !payload.EnforceNonce {
					t.Error("incorrect nonce", payload)
				}
				want, err := application.FormatOperationLog(op)
				if err != nil || payload.Content != want {
					t.Error("wrong operation content", err, payload.Content)
				}
				if name == "lost response" {
					w.WriteHeader(502)
					return
				}
				author := "999"
				if name == "wrong author" {
					author = "998"
				}
				if name == "wrong nonce" {
					payload.Nonce = "different"
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "300", "channel_id": "200", "author": map[string]any{"id": author, "bot": true}, "nonce": payload.Nonce})
			}))
			defer server.Close()
			gateway := discord.New(server.Client(), server.URL, "test-token", fixedClock{now})
			if err := s.ExecuteOperationLog(ctx, gateway, "999", job.ID, "leader"); err != nil {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stored, err := r.GetOutput(ctx, job.ID, false)
				if err != nil {
					return err
				}
				want := application.OutputSucceeded
				if lost {
					want = application.OutputUncertain
				}
				if stored.State != want {
					t.Fatalf("want %s got %s", want, stored.State)
				}
				return nil
			})
			if next, err := s.ClaimOutput(ctx, "leader"); err != nil || next != nil {
				t.Fatal("completed/uncertain output reclaimed", next, err)
			}
			if posts.Load() != 1 {
				t.Fatal("POST repeated", posts.Load())
			}
		})
	}
}
