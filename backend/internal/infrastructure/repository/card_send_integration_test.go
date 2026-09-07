//go:build integration

package repository_test

import (
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

func TestCardExecutionRendersLatestDataAndPersistsCreatedID(t *testing.T) {
	for _, existing := range []bool{false, true} {
		name := "create"
		if existing {
			name = "edit"
		}
		t.Run(name, func(t *testing.T) {
			db, store := rpSetup(t)
			ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
			s := application.New(store, fixedClock{now}, ids{})
			job := queuedOutput("100", application.OutputListRender, now)
			job.TargetID = "100"
			list := &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "before"}, DefaultCategory: "その他"}}
			if existing {
				list.Channel.MessageID = rpPtr("300")
			}
			rpWrite(t, store, func(r application.Repository) error {
				if err := r.PutList(ctx, list); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, job)
				return err
			})
			rpWrite(t, store, func(r application.Repository) error { list.Channel.ListTitle = "latest"; return r.PutList(ctx, list) })
			if claimed, err := s.ClaimOutput(ctx, "leader"); err != nil || claimed == nil {
				t.Fatal(claimed, err)
			}
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				wantMethod, wantPath := http.MethodPost, "/channels/100/messages"
				if existing {
					wantMethod, wantPath = http.MethodPatch, "/channels/100/messages/300"
				}
				if req.Method != wantMethod || req.URL.Path != wantPath {
					t.Errorf("unexpected request %s %s", req.Method, req.URL.Path)
					w.WriteHeader(400)
					return
				}
				var body struct {
					Nonce      string
					Components []struct{ Components []struct{ Content string } }
				}
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				if len(body.Components) == 0 || len(body.Components[0].Components) == 0 || !strings.Contains(body.Components[0].Components[0].Content, "latest") {
					t.Error("stale card content")
				}
				if !existing {
					var nonce string
					if err := db.QueryRowContext(ctx, "SELECT nonce FROM output_dispatches WHERE task_id=$1 AND outcome='unknown'", job.ID).Scan(&nonce); err != nil || nonce != body.Nonce {
						t.Error("uncommitted create", err)
					}
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "300", "channel_id": "100", "author": map[string]any{"id": "999", "bot": true}, "nonce": body.Nonce})
			}))
			defer server.Close()
			if err := s.ExecuteCard(ctx, discord.New(server.Client(), server.URL, "test-token", fixedClock{now}), "999", job.ID, "leader"); err != nil {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stored, err := r.GetOutput(ctx, job.ID, false)
				if err != nil {
					return err
				}
				if stored.State != application.OutputSucceeded {
					t.Fatal(stored.State)
				}
				list, err := r.GetList(ctx, "100", false)
				if err != nil {
					return err
				}
				if list.Channel.MessageID == nil || *list.Channel.MessageID != "300" {
					t.Fatal("message ID not saved")
				}
				return nil
			})
			if calls.Load() != 1 {
				t.Fatal("unexpected HTTP count", calls.Load())
			}
		})
	}
}

func TestCardUnknownMessageClearsIDBeforeProtectedCreate(t *testing.T) {
	db, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	job := queuedOutput("100", application.OutputListRender, now)
	job.TargetID = "100"
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", MessageID: rpPtr("200"), ListTitle: "list"}, DefaultCategory: "その他"}}); err != nil {
			return err
		}
		_, err := r.EnqueueOutput(ctx, job)
		return err
	})
	var posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if req.Method == http.MethodPatch && req.URL.Path == "/channels/100/messages/200" {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"code":10008}`))
			return
		}
		if req.Method != http.MethodPost || req.URL.Path != "/channels/100/messages" {
			t.Error("unexpected request", req.Method, req.URL.Path)
			w.WriteHeader(400)
			return
		}
		posts.Add(1)
		var nonce string
		if err := db.QueryRowContext(ctx, "SELECT nonce FROM output_dispatches WHERE task_id=$1 AND outcome='unknown'", job.ID).Scan(&nonce); err != nil {
			t.Error("creation not protected", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "300", "channel_id": "100", "author": map[string]any{"id": "999", "bot": true}, "nonce": nonce})
	}))
	defer server.Close()
	gateway := discord.New(server.Client(), server.URL, "test-token", fixedClock{now})
	if claimed, err := s.ClaimOutput(ctx, "leader"); err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	if err := s.ExecuteCard(ctx, gateway, "999", job.ID, "leader"); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		list, err := r.GetList(ctx, "100", false)
		if err != nil {
			return err
		}
		if list.Channel.MessageID != nil {
			t.Fatal("missing message ID still retained")
		}
		return nil
	})
	s = application.New(store, fixedClock{now.Add(2 * time.Second)}, ids{})
	if claimed, err := s.ClaimOutput(ctx, "leader"); err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	if err := s.ExecuteCard(ctx, gateway, "999", job.ID, "leader"); err != nil {
		t.Fatal(err)
	}
	if posts.Load() != 1 {
		t.Fatal("unexpected creation count", posts.Load())
	}
}
