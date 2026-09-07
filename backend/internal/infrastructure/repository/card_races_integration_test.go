//go:build integration

package repository_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/discord"
)

func TestCardCleanupIntentsSurviveRedrawAndRecreatedParent(t *testing.T) {
	for _, recoverRunning := range []bool{false, true} {
		t.Run(map[bool]string{false: "pending", true: "recovered"}[recoverRunning], func(t *testing.T) {
			_, store := rpSetup(t)
			ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
			rpWrite(t, store, func(r application.Repository) error {
				for _, messageID := range []string{"300", "302", ""} {
					job := queuedOutput("100", application.OutputListRender, now)
					job.Payload.MessageID = messageID
					if _, err := r.EnqueueOutput(ctx, job); err != nil {
						return err
					}
				}
				return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "recreated", MessageID: rpPtr("301")}, DefaultCategory: "other"}})
			})
			s := application.New(store, fixedClock{now}, ids{})
			if recoverRunning {
				job, err := s.ClaimOutput(ctx, "old-worker")
				if err != nil || job == nil || job.Payload.MessageID != "300" {
					t.Fatal(job, err)
				}
				if err := s.RecoverRunningOutputs(ctx); err != nil {
					t.Fatal(err)
				}
			}
			var deleted []string
			var edits int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == "DELETE" && (r.URL.Path == "/channels/100/messages/300" || r.URL.Path == "/channels/100/messages/302"):
					deleted = append(deleted, r.URL.Path)
					w.WriteHeader(204)
				case r.Method == "PATCH" && r.URL.Path == "/channels/100/messages/301":
					edits++
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"id":"301","channel_id":"100","author":{"id":"999","bot":true}}`))
				default:
					t.Errorf("unexpected output %s %s", r.Method, r.URL.Path)
					w.WriteHeader(400)
				}
			}))
			defer server.Close()
			gateway := discord.New(server.Client(), server.URL, "test-token", fixedClock{now})
			for range 3 {
				job, err := s.ClaimOutput(ctx, "worker")
				if err != nil || job == nil {
					t.Fatal(job, err)
				}
				if err := s.ExecuteCard(ctx, gateway, "999", job.ID, "worker"); err != nil {
					t.Fatal(err)
				}
			}
			server.Close()
			if strings.Join(deleted, ",") != "/channels/100/messages/300,/channels/100/messages/302" || edits != 1 {
				t.Fatal(deleted, edits)
			}
		})
	}
}

func TestTaskDeletionDuringCreateReservesOrphanCleanup(t *testing.T) {
	for _, alreadyDeleted := range []bool{false, true} {
		name := "delete success"
		if alreadyDeleted {
			name = "delete 404"
		}
		t.Run(name, func(t *testing.T) {
			_, store := rpSetup(t)
			ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
			_, ch, task := rpSeedCatalogTask(t, store)
			task.MessageID = nil
			job := queuedOutput(ch.ChannelID, application.OutputTaskCard, now)
			job.TargetID = task.ID
			rpWrite(t, store, func(r application.Repository) error {
				if err := r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, job)
				return err
			})
			s := application.New(store, fixedClock{now}, ids{})
			var posts, deletes atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if req.Method == http.MethodPost && req.URL.Path == "/channels/300/messages" {
					posts.Add(1)
					// This business write must complete while the Discord response is
					// pending; a retained transaction/parent lock would deadlock it.
					writeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
					defer cancel()
					if err := s.DeleteTask(writeCtx, ch.ChannelID, task.ID); err != nil {
						t.Error("concurrent business delete", err)
						w.WriteHeader(500)
						return
					}
					var body struct{ Nonce string }
					if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
						t.Error(err)
						w.WriteHeader(400)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "900", "channel_id": "300", "author": map[string]any{"id": "999", "bot": true}, "nonce": body.Nonce})
					return
				}
				if req.Method == http.MethodDelete && req.URL.Path == "/channels/300/messages/900" {
					deletes.Add(1)
					if alreadyDeleted {
						w.WriteHeader(404)
						_, _ = w.Write([]byte(`{"code":10008}`))
					} else {
						w.WriteHeader(204)
					}
					return
				}
				t.Error("unexpected request", req.Method, req.URL.Path)
				w.WriteHeader(400)
			}))
			defer server.Close()
			gateway := discord.New(server.Client(), server.URL, "test-token", fixedClock{now})
			// The deleted task's redraw becomes a no-op; cleanup remains its own
			// reservation and must not be coalesced into that redraw.
			for i := 0; i < 3; i++ {
				claimed, err := s.ClaimOutput(ctx, "leader")
				if err != nil || claimed == nil {
					t.Fatal(claimed, err)
				}
				if err := s.ExecuteCard(ctx, gateway, "999", claimed.ID, "leader"); err != nil {
					t.Fatal(err)
				}
			}
			if posts.Load() != 1 || deletes.Load() != 1 {
				t.Fatal("orphan not cleaned exactly once", posts.Load(), deletes.Load())
			}
			if next, err := s.ClaimOutput(ctx, "leader"); err != nil || next != nil {
				t.Fatal("cleanup remains pending", next, err)
			}
		})
	}
}

func TestTaskCreationRestoresSavedSelectionUsingConfirmedMessageID(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	_, ch, task := rpSeedCatalogTask(t, store)
	task.MessageID = nil
	job := queuedOutput(ch.ChannelID, application.OutputTaskCard, now)
	job.TargetID = task.ID
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false); err != nil {
			return err
		}
		if _, err := r.PutCardView(ctx, application.CardView{ChannelID: ch.ChannelID, TargetKind: application.CardTask, TargetID: task.ID, Mode: application.CardUpdateSelection}); err != nil {
			return err
		}
		_, err := r.EnqueueOutput(ctx, job)
		return err
	})
	s := application.New(store, fixedClock{now}, ids{})
	var posts, edits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		encoded, _ := json.Marshal(body)
		if req.Method == http.MethodPost {
			posts.Add(1)
			if strings.Contains(string(encoded), "remind-task-update-select:") {
				t.Error("selection used an unconfirmed ID")
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "900", "channel_id": "300", "author": map[string]any{"id": "999", "bot": true}, "nonce": body["nonce"]})
			return
		}
		if req.Method == http.MethodPatch && req.URL.Path == "/channels/300/messages/900" {
			edits.Add(1)
			if !strings.Contains(string(encoded), "remind-task-update-select:900") || !strings.Contains(string(encoded), "remind-task-update-cancel:900") {
				t.Error("selection not restored", string(encoded))
			}
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
	if err := s.ExecuteCard(ctx, discord.New(server.Client(), server.URL, "test-token", fixedClock{now}), "999", job.ID, "leader"); err != nil {
		t.Fatal(err)
	}
	if posts.Load() != 1 || edits.Load() != 1 {
		t.Fatal(posts.Load(), edits.Load())
	}
	rpRead(t, store, func(r application.Repository) error {
		view, err := r.GetCardView(ctx, ch.ChannelID, application.CardTask, task.ID)
		if err != nil {
			return err
		}
		if view == nil || view.Mode != application.CardUpdateSelection {
			t.Fatal("saved view changed", view)
		}
		stored, err := r.GetOutput(ctx, job.ID, false)
		if err != nil {
			return err
		}
		if stored.State != application.OutputSucceeded {
			t.Fatal(stored.State)
		}
		return nil
	})
}
