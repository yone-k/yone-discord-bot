//go:build integration

package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

// Unused gateway methods panic: a nursery notice must not touch threads.
type nurseryGateway struct {
	application.DiscordGateway
	destinations []string
	messages     []application.DisplayMessage
}

func (g *nurseryGateway) CreateMessage(_ context.Context, destination string, message application.DisplayMessage, nonce string) (application.DiscordMessage, error) {
	g.destinations = append(g.destinations, destination)
	g.messages = append(g.messages, message)
	return application.DiscordMessage{ID: "900", ChannelID: destination, AuthorID: "999", AuthorIsBot: true, Nonce: nonce}, nil
}

// 2026-10-02 07:00 JST.
var nurseryMorning = time.Date(2026, 10, 1, 22, 0, 0, 0, time.UTC)

func nmSeed(t *testing.T, store *repository.Store, channel string, dates ...string) {
	t.Helper()
	nmWrite(t, store, func(r application.Repository) error {
		if channel != "" {
			if err := r.PutNurseryMenuChannel(t.Context(), channel, nurseryMorning); err != nil {
				return err
			}
		}
		for _, date := range dates {
			if err := r.PutNurseryMenu(t.Context(), domain.NurseryMenu{ID: rpID(), Date: date, Lunch: "ご飯", CreatedAt: nurseryMorning, UpdatedAt: nurseryMorning}); err != nil {
				return err
			}
		}
		return nil
	})
}

func nmNotices(t *testing.T, store *repository.Store) []application.OutputTask {
	t.Helper()
	var notices []application.OutputTask
	rpRead(t, store, func(r application.Repository) error {
		jobs, err := r.ListOutputs(t.Context(), application.OutputFilter{})
		for _, job := range jobs {
			if job.Kind == application.OutputNurseryMenuNotice {
				notices = append(notices, job)
			}
		}
		return err
	})
	return notices
}

func nmReserve(t *testing.T, store *repository.Store, at time.Time) *application.Service {
	t.Helper()
	s := application.New(store, fixedClock{at}, ids{})
	if err := s.ReserveNotifications(t.Context()); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNurseryMenuNoticeIsReservedOnceInsideTheMorningWindow(t *testing.T) {
	for name, c := range map[string]struct {
		at      time.Time
		channel string
		dates   []string
		want    int
	}{
		"before seven":   {nurseryMorning.Add(-time.Second), "100", []string{"2026-10-02"}, 0},
		"seven":          {nurseryMorning, "100", []string{"2026-10-02"}, 1},
		"before noon":    {nurseryMorning.Add(5*time.Hour - time.Second), "100", []string{"2026-10-02"}, 1},
		"noon":           {nurseryMorning.Add(5 * time.Hour), "100", []string{"2026-10-02"}, 0},
		"no menu today":  {nurseryMorning, "100", []string{"2026-10-03"}, 0},
		"no destination": {nurseryMorning, "", []string{"2026-10-02"}, 0},
	} {
		t.Run(name, func(t *testing.T) {
			_, store := rpSetup(t)
			nmSeed(t, store, c.channel, c.dates...)
			nmReserve(t, store, c.at)
			nmReserve(t, store, c.at)
			notices := nmNotices(t, store)
			if len(notices) != c.want {
				t.Fatalf("got %d notices", len(notices))
			}
			if c.want == 1 && (notices[0].ChannelID != "100" || notices[0].TargetID != "2026-10-02" || notices[0].Payload.DestinationID != "100") {
				t.Fatalf("%+v", notices[0])
			}
		})
	}
}

func nmRun(t *testing.T, store *repository.Store, at time.Time, g *nurseryGateway) application.OutputTask {
	t.Helper()
	s := application.New(store, fixedClock{at}, ids{})
	job, err := s.ClaimOutput(t.Context(), "leader")
	if err != nil || job == nil {
		t.Fatal(job, err)
	}
	if err := s.ExecuteOutput(t.Context(), g, "999", *job, "leader"); err != nil {
		t.Fatal(err)
	}
	var stored *application.OutputTask
	rpRead(t, store, func(r application.Repository) (err error) {
		stored, err = r.GetOutput(t.Context(), job.ID, false)
		return
	})
	return *stored
}

func TestNurseryMenuNoticePostsToTheChannelOncePerDay(t *testing.T) {
	_, store := rpSetup(t)
	nmSeed(t, store, "100", "2026-10-02")
	nmReserve(t, store, nurseryMorning)
	g := &nurseryGateway{}
	if job := nmRun(t, store, nurseryMorning, g); job.State != application.OutputSucceeded {
		t.Fatalf("%+v", job)
	}
	if len(g.destinations) != 1 || g.destinations[0] != "100" || len(g.messages[0].Components) != 2 || g.messages[0].Components[0].Text != "@everyone" {
		t.Fatalf("%v %+v", g.destinations, g.messages)
	}
	nmSeed(t, store, "200")
	nmReserve(t, store, nurseryMorning.Add(time.Hour))
	if notices := nmNotices(t, store); len(notices) != 1 {
		t.Fatalf("posted day was reserved again after the destination changed: %d", len(notices))
	}
}

func TestNurseryMenuNoticeIsCancelledWhenItsConditionsChangeBeforeSending(t *testing.T) {
	for name, change := range map[string]func(*testing.T, *repository.Store) time.Time{
		"menu deleted": func(t *testing.T, store *repository.Store) time.Time {
			nmWrite(t, store, func(r application.Repository) error { return r.DeleteNurseryMenu(t.Context(), "2026-10-02") })
			return nurseryMorning
		},
		"destination changed": func(t *testing.T, store *repository.Store) time.Time {
			nmSeed(t, store, "200")
			return nurseryMorning
		},
		"noon passed": func(*testing.T, *repository.Store) time.Time { return nurseryMorning.Add(5 * time.Hour) },
	} {
		t.Run(name, func(t *testing.T) {
			_, store := rpSetup(t)
			nmSeed(t, store, "100", "2026-10-02")
			nmReserve(t, store, nurseryMorning)
			at := change(t, store)
			g := &nurseryGateway{}
			if job := nmRun(t, store, at, g); job.State != application.OutputCancelled || len(g.destinations) != 0 {
				t.Fatalf("%+v %v", job, g.destinations)
			}
		})
	}
}

func TestUnsentCancelledNurseryMenuNoticeAllowsTheDayToBePostedLater(t *testing.T) {
	_, store := rpSetup(t)
	nmSeed(t, store, "100", "2026-10-02")
	nmReserve(t, store, nurseryMorning)
	nmSeed(t, store, "200")
	g := &nurseryGateway{}
	if job := nmRun(t, store, nurseryMorning, g); job.State != application.OutputCancelled {
		t.Fatalf("%+v", job)
	}
	nmReserve(t, store, nurseryMorning.Add(time.Minute))
	if job := nmRun(t, store, nurseryMorning.Add(time.Minute), g); job.State != application.OutputSucceeded || job.ChannelID != "200" {
		t.Fatalf("%+v", job)
	}
	nmSeed(t, store, "100")
	nmReserve(t, store, nurseryMorning.Add(2*time.Minute))
	if len(g.destinations) != 1 || g.destinations[0] != "200" {
		t.Fatal(g.destinations)
	}
	s := application.New(store, fixedClock{nurseryMorning.Add(2 * time.Minute)}, ids{})
	if job, err := s.ClaimOutput(t.Context(), "leader"); err != nil || job != nil {
		t.Fatal("a delivered day was reserved again for the previous channel", job, err)
	}
}
