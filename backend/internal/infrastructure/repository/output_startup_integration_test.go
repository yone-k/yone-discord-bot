//go:build integration

package repository_test

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestStartupOutputResetsViewsPreservesIDsAndSuspension(t *testing.T) {
	_, store := rpSetup(t)
	catalog, ch, task := rpSeedCatalogTask(t, store)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", MessageID: rpPtr("101"), ListTitle: "list"}, DefaultCategory: "その他"}}); err != nil {
			return err
		}
		if _, err := r.PutCardView(ctx, application.CardView{ChannelID: ch.ChannelID, TargetKind: application.CardTask, TargetID: task.ID, Mode: application.CardUpdateSelection}); err != nil {
			return err
		}
		if _, err := r.PutCardView(ctx, application.CardView{ChannelID: catalog.Channel.ChannelID, TargetKind: application.CardInventory, TargetID: catalog.Channel.ChannelID, Mode: application.CardDeleteSelection}); err != nil {
			return err
		}
		return r.PutSuspension(ctx, application.OutputSuspension{ChannelID: ch.ChannelID, SuspendedAt: now, SuspendedBy: "123"})
	})
	s := application.New(store, fixedClock{now}, ids{})
	for i := 0; i < 2; i++ {
		if err := s.ReserveStartupOutputs(ctx); err != nil {
			t.Fatal(err)
		}
	}
	rpRead(t, store, func(r application.Repository) error {
		storedTask, err := r.GetTask(ctx, ch.ChannelID, task.ID, false)
		if err != nil {
			return err
		}
		rpEqual(t, task, storedTask)
		storedChannel, err := r.GetRemindChannel(ctx, ch.ChannelID, false)
		if err != nil {
			return err
		}
		rpEqual(t, ch, storedChannel)
		storedCatalog, err := r.GetCatalog(ctx, catalog.Channel.ChannelID, false)
		if err != nil {
			return err
		}
		rpEqual(t, catalog, storedCatalog)
		stop, err := r.GetSuspension(ctx, ch.ChannelID)
		if err != nil {
			return err
		}
		if stop == nil {
			t.Fatal("restart resumed suspended channel")
		}
		for _, target := range []application.CardView{{ChannelID: ch.ChannelID, TargetKind: application.CardTask, TargetID: task.ID}, {ChannelID: catalog.Channel.ChannelID, TargetKind: application.CardInventory, TargetID: catalog.Channel.ChannelID}} {
			view, err := r.GetCardView(ctx, target.ChannelID, target.TargetKind, target.TargetID)
			if err != nil {
				return err
			}
			if view == nil || view.Mode != application.CardNormal || view.Page != 0 {
				t.Fatal("restart retained selection", view)
			}
		}
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{})
		if err != nil {
			return err
		}
		counts := map[application.OutputKind]int{}
		for _, job := range jobs {
			counts[job.Kind]++
			if job.OperationID != "" {
				t.Fatal("startup invented an actor operation")
			}
		}
		if len(jobs) != 6 || counts[application.OutputListRender] != 1 || counts[application.OutputInventoryRender] != 1 || counts[application.OutputTaskCard] != 1 || counts[application.OutputThreadEnsure] != 3 {
			t.Fatal("startup reservations missing or duplicated", counts)
		}
		return nil
	})
}

func TestNewReminderChannelRecordsCreationIntentAtomically(t *testing.T) {
	for _, scenario := range []string{"new", "legacy", "reservation failure"} {
		t.Run(scenario, func(t *testing.T) {
			db, store := rpSetup(t)
			ctx := t.Context()
			ch := domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "tasks"}}
			if scenario == "legacy" {
				rpWrite(t, store, func(r application.Repository) error { return r.PutRemindChannel(ctx, &ch) })
			}
			if scenario == "reservation failure" {
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER reject_reservation BEFORE INSERT ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_reservation()`); err != nil {
					t.Fatal(err)
				}
			}
			s := application.New(store, fixedClock{time.Now().UTC().Truncate(time.Millisecond)}, ids{})
			_, err := s.SaveRemindChannel(ctx, ch)
			if (err != nil) != (scenario == "reservation failure") {
				t.Fatal("unexpected save result", err)
			}
			if scenario != "reservation failure" {
				if err := s.ReserveStartupOutputs(ctx); err != nil {
					t.Fatal(err)
				}
			}
			rpRead(t, store, func(r application.Repository) error {
				stored, err := r.GetRemindChannel(ctx, ch.ChannelID, false)
				if err != nil {
					return err
				}
				jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: ch.ChannelID})
				if err != nil {
					return err
				}
				if scenario == "reservation failure" {
					if stored != nil || len(jobs) != 0 {
						t.Fatal("channel escaped failed intent reservation")
					}
				} else {
					if stored == nil || len(jobs) != 1 || jobs[0].Kind != application.OutputThreadEnsure {
						t.Fatal("creation intent missing", jobs)
					}
					if jobs[0].Payload.AllowCreate != (scenario == "new") {
						t.Fatal("new/legacy creation intent confused", jobs[0])
					}
				}
				return nil
			})
		})
	}
}
