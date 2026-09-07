//go:build integration

package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

type noticeGateway struct {
	application.DiscordGateway
	thread    application.DiscordThread
	beforeGet func()
	posts     int
}

func (g *noticeGateway) GetThread(context.Context, string) (application.DiscordThread, error) {
	if g.beforeGet != nil {
		g.beforeGet()
	}
	return g.thread, nil
}

func (g *noticeGateway) CreateMessage(_ context.Context, destination string, _ application.DisplayMessage, nonce string) (application.DiscordMessage, error) {
	g.posts++
	return application.DiscordMessage{ID: "900", ChannelID: destination, AuthorID: "999", AuthorIsBot: true, Nonce: nonce}, nil
}

func TestNotificationExecutionRechecksAfterThreadLookup(t *testing.T) {
	for _, scenario := range []string{"success", "paused during lookup", "previous day"} {
		t.Run(scenario, func(t *testing.T) {
			_, store := rpSetup(t)
			_, ch, task := rpSeedCatalogTask(t, store)
			ctx, now := t.Context(), time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
			task.IsPaused, task.OverdueNotifyCount, task.LastOverdueNotifiedAt = false, 0, nil
			task.NextDueAt = now.Add(-time.Hour)
			rpWrite(t, store, func(r application.Repository) error { return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false) })
			s := application.New(store, fixedClock{now}, ids{})
			if err := s.ReserveNotifications(ctx); err != nil {
				t.Fatal(err)
			}
			if scenario == "previous day" {
				s = application.New(store, fixedClock{now.Add(24 * time.Hour)}, ids{})
			}
			job, err := s.ClaimOutput(ctx, "leader")
			if err != nil || job == nil {
				t.Fatal(job, err)
			}
			g := &noticeGateway{thread: application.DiscordThread{ID: *ch.RemindNoticeThreadID, ParentID: ch.ChannelID}}
			if scenario == "paused during lookup" {
				g.beforeGet = func() {
					task.IsPaused = true
					task.Revision++
					rpWrite(t, store, func(r application.Repository) error { return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false) })
				}
			}
			if err := s.ExecuteNotification(ctx, g, "999", job.ID, "leader"); err != nil {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stored, err := r.GetOutput(ctx, job.ID, false)
				if err != nil {
					return err
				}
				current, err := r.GetTask(ctx, ch.ChannelID, task.ID, false)
				if err != nil {
					return err
				}
				wantState, wantPosts := application.OutputCancelled, 0
				if scenario == "success" {
					wantState, wantPosts = application.OutputSucceeded, 1
				}
				if stored.State != wantState || g.posts != wantPosts || current.OverdueNotifyCount != wantPosts {
					t.Fatalf("state=%s posts=%d ack=%d", stored.State, g.posts, current.OverdueNotifyCount)
				}
				return nil
			})
			if scenario == "paused during lookup" {
				task.IsPaused = false
				task.Revision++
				rpWrite(t, store, func(r application.Repository) error { return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false) })
				if err := s.ReserveNotifications(ctx); err != nil {
					t.Fatal(err)
				}
				resumed, err := s.ClaimOutput(ctx, "leader")
				if err != nil || resumed == nil || resumed.ID != job.ID {
					t.Fatalf("expired unsent notification not resumed: %v %v", resumed, err)
				}
				g.beforeGet = nil
				if err := s.ExecuteNotification(ctx, g, "999", resumed.ID, "leader"); err != nil {
					t.Fatal(err)
				}
				if g.posts != 1 {
					t.Fatal("resumed notification not sent exactly once", g.posts)
				}
			}
		})
	}
}
