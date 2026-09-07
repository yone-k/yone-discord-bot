//go:build integration

package repository_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/discord"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

func TestOutputWorkerContinuesOtherChannelsDuringSlowDiscordResponse(t *testing.T) {
	_, store := rpSetup(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	rpWrite(t, store, func(r application.Repository) error {
		for _, channel := range []string{"100", "200"} {
			if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: channel, ListTitle: channel}, DefaultCategory: "その他"}}); err != nil {
				return err
			}
		}
		return nil
	})
	firstStarted, secondFinished, release := make(chan struct{}, 1), make(chan struct{}, 1), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method == http.MethodPatch && (req.URL.Path == "/channels/100/messages/1001" || req.URL.Path == "/channels/200/messages/2001") || req.Method == http.MethodPut && (req.URL.Path == "/channels/100/pins/1001" || req.URL.Path == "/channels/200/pins/2001") {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		channel := "200"
		if req.URL.Path == "/channels/100/messages" {
			channel = "100"
			select {
			case firstStarted <- struct{}{}:
			default:
			}
			select {
			case <-release:
			case <-req.Context().Done():
				return
			}
		} else if req.URL.Path != "/channels/200/messages" {
			t.Error("unexpected request", req.URL.Path)
			w.WriteHeader(400)
			return
		}
		var body struct{ Nonce string }
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": channel + "1", "channel_id": channel, "author": map[string]any{"id": "999", "bot": true}, "nonce": body.Nonce})
	}))
	defer server.Close()
	s := application.New(store, realWorkerClock{}, ids{})
	gateway := discord.New(server.Client(), server.URL, "test-token", realWorkerClock{})
	worker := application.OutputWorker{Service: s, Leadership: repository.NewOutputLeadership(os.Getenv("TEST_DATABASE_URL")), Execute: func(ctx context.Context, job application.OutputTask, executor string) error {
		err := s.ExecuteOutput(ctx, gateway, "999", job, executor)
		if err == nil && job.ChannelID == "200" {
			select {
			case secondFinished <- struct{}{}:
			default:
			}
		}
		return err
	}}
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	defer func() {
		once.Do(func() { close(release) })
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(15 * time.Second):
			t.Error("worker failed to stop")
		}
	}()
	for _, signal := range []<-chan struct{}{firstStarted, secondFinished} {
		select {
		case <-signal:
		case <-time.After(5 * time.Second):
			t.Fatal("another channel was blocked by slow Discord")
		}
	}
	if !worker.Running() {
		t.Fatal("worker not reporting active leadership")
	}
	once.Do(func() { close(release) })
}

type realWorkerClock struct{}

func (realWorkerClock) Now() time.Time { return time.Now().UTC() }

func TestOutputWorkerLeadershipLossRecoversCreateWithoutResending(t *testing.T) {
	db, store := rpSetup(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list"}, DefaultCategory: "その他"}})
	})
	started := make(chan struct{}, 1)
	var posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		posts.Add(1)
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-req.Context().Done():
		case <-ctx.Done():
		}
	}))
	defer server.Close()
	s := application.New(store, realWorkerClock{}, ids{})
	gateway := discord.New(server.Client(), server.URL, "test-token", realWorkerClock{})
	worker := application.OutputWorker{Service: s, Leadership: repository.NewOutputLeadership(os.Getenv("TEST_DATABASE_URL")), Execute: func(ctx context.Context, job application.OutputTask, executor string) error {
		return s.ExecuteOutput(ctx, gateway, "999", job, executor)
	}}
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(15 * time.Second):
			t.Error("worker did not stop")
		}
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not start POST")
	}
	var terminated bool
	if err := db.QueryRowContext(ctx, `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=44001 AND granted`).Scan(&terminated); err != nil || !terminated {
		t.Fatal("cannot interrupt test leader", err)
	}
	deadline := time.NewTimer(6 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM output_tasks WHERE state='uncertain'").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			break
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("unknown create was not recovered")
		}
	}
	if posts.Load() != 1 {
		t.Fatal("create was resent after leadership loss", posts.Load())
	}
}
