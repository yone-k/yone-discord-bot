//go:build integration

package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type pinGateway struct {
	application.DiscordGateway
	posts, pins int
	failPin     bool
}

func (g *pinGateway) CreateMessage(_ context.Context, channel string, _ application.DisplayMessage, nonce string) (application.DiscordMessage, error) {
	g.posts++
	return application.DiscordMessage{ID: "300", ChannelID: channel, AuthorID: "999", AuthorIsBot: true, Nonce: nonce}, nil
}
func (g *pinGateway) EditMessage(context.Context, string, string, application.DisplayMessage) error {
	return nil
}
func (g *pinGateway) PinMessage(context.Context, string, string) error {
	g.pins++
	if g.failPin {
		return &application.DiscordFailure{Kind: application.DiscordRateLimited, RetryAfter: time.Second}
	}
	return nil
}

func TestInitializationPinSurvivesCoalescingAndRetriesWithoutNewPost(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list"}, DefaultCategory: "その他"}})
	})
	s := application.New(store, fixedClock{now}, ids{})
	if err := s.ReserveStartupOutputs(ctx); err != nil {
		t.Fatal(err)
	}
	// A later ordinary redraw must not erase the initialization's pin intent.
	if _, err := s.RedrawOutputs(ctx, "100", "list"); err != nil {
		t.Fatal(err)
	}
	job, err := s.ClaimOutput(ctx, "leader")
	if err != nil || job == nil {
		t.Fatal(job, err)
	}
	g := &pinGateway{failPin: true}
	if err := s.ExecuteCard(ctx, g, "999", job.ID, "leader"); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		stored, err := r.GetOutput(ctx, job.ID, false)
		if err != nil {
			return err
		}
		list, err := r.GetList(ctx, "100", false)
		if err != nil {
			return err
		}
		if stored.State != application.OutputRetryWait || list.Channel.MessageID == nil || *list.Channel.MessageID != "300" {
			t.Fatal("pin failure lost confirmed card", stored, list)
		}
		return nil
	})
	s = application.New(store, fixedClock{now.Add(2 * time.Second)}, ids{})
	if claimed, err := s.ClaimOutput(ctx, "leader"); err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	g.failPin = false
	if err := s.ExecuteCard(ctx, g, "999", job.ID, "leader"); err != nil {
		t.Fatal(err)
	}
	if g.posts != 1 || g.pins != 2 {
		t.Fatalf("posts=%d pins=%d", g.posts, g.pins)
	}
}
