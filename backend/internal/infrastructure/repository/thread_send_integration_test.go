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

func TestReminderThreadEnsureReusesOrHoldsCreation(t *testing.T) {
	for _, scenario := range []string{"reuse", "missing legacy IDs", "thread response lost", "new thread"} {
		t.Run(scenario, func(t *testing.T) {
			_, store := rpSetup(t)
			_, ch, _ := rpSeedCatalogTask(t, store)
			ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
			job := queuedOutput(ch.ChannelID, application.OutputThreadEnsure, now)
			job.TargetID = "reminder:reminder_notice"
			job.Payload = application.OutputPayload{ChannelKind: "reminder", ThreadPurpose: "reminder_notice", AllowCreate: scenario == "thread response lost" || scenario == "new thread"}
			if scenario != "reuse" {
				ch.RemindNoticeMessageID, ch.RemindNoticeThreadID = nil, nil
			}
			rpWrite(t, store, func(r application.Repository) error {
				if err := r.PutRemindChannel(ctx, ch); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, job)
				return err
			})
			s := application.New(store, fixedClock{now}, ids{})
			var posts, requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				requests.Add(1)
				w.Header().Set("Content-Type", "application/json")
				if req.Method == http.MethodPost {
					posts.Add(1)
					if req.URL.Path == "/channels/300/messages" {
						var body struct{ Nonce string }
						if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
							t.Error(err)
							w.WriteHeader(400)
							return
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"id": "900", "channel_id": "300", "author": map[string]any{"id": "999", "bot": true}, "nonce": body.Nonce})
						return
					}
					if req.URL.Path == "/channels/300/messages/900/threads" {
						if scenario == "thread response lost" {
							w.WriteHeader(502)
						} else {
							_, _ = w.Write([]byte(`{"id":"901","parent_id":"300","owner_id":"999","thread_metadata":{"archived":false}}`))
						}
						return
					}
				}
				if req.Method == http.MethodGet && req.URL.Path == "/channels/300/messages/304" {
					_, _ = w.Write([]byte(`{"id":"304","channel_id":"300","author":{"id":"999","bot":true}}`))
					return
				}
				if req.Method == http.MethodGet && req.URL.Path == "/channels/303" {
					_, _ = w.Write([]byte(`{"id":"303","parent_id":"300","owner_id":"999","thread_metadata":{"archived":true}}`))
					return
				}
				if req.Method == http.MethodPut && (req.URL.Path == "/channels/300/pins/304" || req.URL.Path == "/channels/300/pins/900") {
					w.WriteHeader(204)
					return
				}
				if req.Method == http.MethodPatch && (req.URL.Path == "/channels/300/messages/304" || req.URL.Path == "/channels/303") {
					w.WriteHeader(204)
					return
				}
				t.Error("unexpected request", req.Method, req.URL.Path)
				w.WriteHeader(400)
			}))
			defer server.Close()
			if claimed, err := s.ClaimOutput(ctx, "leader"); err != nil || claimed == nil {
				t.Fatal(claimed, err)
			}
			if err := s.ExecuteThreadEnsure(ctx, discord.New(server.Client(), server.URL, "test-token", fixedClock{now}), "999", job.ID, "leader"); err != nil {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stored, err := r.GetOutput(ctx, job.ID, false)
				if err != nil {
					return err
				}
				want := application.OutputUncertain
				if scenario == "reuse" || scenario == "new thread" {
					want = application.OutputSucceeded
				}
				if stored.State != want {
					t.Fatal("incorrect state", stored.State)
				}
				if scenario == "missing legacy IDs" && stored.LastError != "既存通知先の所在不明" {
					t.Fatal(stored.LastError)
				}
				current, err := r.GetRemindChannel(ctx, ch.ChannelID, false)
				if err != nil {
					return err
				}
				if scenario == "thread response lost" && (current.RemindNoticeMessageID == nil || *current.RemindNoticeMessageID != "900" || current.RemindNoticeThreadID != nil) {
					t.Fatal("parent confirmation lost", current)
				}
				if scenario == "new thread" && (current.RemindNoticeMessageID == nil || *current.RemindNoticeMessageID != "900" || current.RemindNoticeThreadID == nil || *current.RemindNoticeThreadID != "901") {
					t.Fatal("created destination not saved", current)
				}
				return nil
			})
			if scenario == "missing legacy IDs" && requests.Load() != 0 {
				t.Fatal("unknown destination triggered HTTP")
			}
			wantPosts := int32(0)
			if scenario == "thread response lost" || scenario == "new thread" {
				wantPosts = 2
			}
			if posts.Load() != wantPosts {
				t.Fatal("unexpected creation count", posts.Load())
			}
		})
	}
}
