//go:build integration

package repository_test

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestCardViewChangesPersistAndReserveRendering(t *testing.T) {
	for _, kind := range []application.CardTarget{application.CardTask, application.CardInventory} {
		t.Run(string(kind), func(t *testing.T) {
			_, store := rpSetup(t)
			catalog, ch, task := rpSeedCatalogTask(t, store)
			channel, target, mode := ch.ChannelID, task.ID, application.CardUpdateSelection
			actorKind := application.OperationKind("RemindTaskUpdateButtonHandler")
			if kind == application.CardInventory {
				channel, target, mode = catalog.Channel.ChannelID, catalog.Channel.ChannelID, application.CardDeleteSelection
				actorKind = "InventoryDeleteButtonHandler"
			}
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: actorKind})
			if err != nil {
				t.Fatal(err)
			}
			s := application.New(store, fixedClock{time.Now().UTC().Truncate(time.Millisecond)}, ids{})
			view, err := s.SetCardView(ctx, application.CardView{ChannelID: channel, TargetKind: kind, TargetID: target, Mode: mode})
			if err != nil {
				t.Fatal(err)
			}
			if view.Version != 1 || view.Mode != mode {
				t.Fatal(view)
			}
			view, err = s.SetCardView(ctx, application.CardView{ChannelID: channel, TargetKind: kind, TargetID: target, Mode: application.CardNormal})
			if err != nil {
				t.Fatal(err)
			}
			if view.Version != 2 || view.Mode != application.CardNormal {
				t.Fatal(view)
			}
			rpRead(t, store, func(r application.Repository) error {
				jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: channel})
				if err != nil {
					return err
				}
				if len(jobs) != 1 || jobs[0].OperationID == "" {
					t.Fatal("view rendering not coalesced with operation", jobs)
				}
				return nil
			})
		})
	}
}

func TestInventoryCardViewClampsPageAndRollsBackOnReservationFailure(t *testing.T) {
	db, store := rpSetup(t)
	catalog, _, _ := rpSeedCatalogTask(t, store)
	ctx, channel := t.Context(), catalog.Channel.ChannelID
	for len(catalog.Items) < 26 {
		id := rpID()
		catalog.Items = append(catalog.Items, domain.InventoryItem{ID: id, EntityID: id, Name: id, Position: len(catalog.Items)})
	}
	rpWrite(t, store, func(r application.Repository) error { return r.PutCatalog(ctx, catalog) })
	s := application.New(store, fixedClock{time.Now().UTC().Truncate(time.Millisecond)}, ids{})
	view, err := s.SetCardView(ctx, application.CardView{ChannelID: channel, TargetKind: application.CardInventory, TargetID: channel, Mode: application.CardDeleteSelection, Page: 99})
	if err != nil {
		t.Fatal(err)
	}
	if view.Page != 1 {
		t.Fatal("page not clamped", view)
	}
	if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER reject_reservation BEFORE INSERT ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_reservation()`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetCardView(ctx, application.CardView{ChannelID: channel, TargetKind: application.CardInventory, TargetID: channel, Mode: application.CardNormal}); err == nil {
		t.Fatal("view saved without redraw")
	}
	rpRead(t, store, func(r application.Repository) error {
		stored, err := r.GetCardView(ctx, channel, application.CardInventory, channel)
		if err != nil {
			return err
		}
		if stored.Mode != application.CardDeleteSelection || stored.Page != 1 || stored.Version != 1 {
			t.Fatal("view escaped rollback", stored)
		}
		return nil
	})
}

func TestInventoryDeletionRestoresNormalViewOnlyOnCommit(t *testing.T) {
	for _, scenario := range []string{"success", "referenced", "reservation failure"} {
		t.Run(scenario, func(t *testing.T) {
			db, store := rpSetup(t)
			catalog, _, _ := rpSeedCatalogTask(t, store)
			ctx := t.Context()
			channel := catalog.Channel.ChannelID
			rpWrite(t, store, func(r application.Repository) error {
				_, err := r.PutCardView(ctx, application.CardView{ChannelID: channel, TargetKind: application.CardInventory, TargetID: channel, Mode: application.CardDeleteSelection})
				return err
			})
			if scenario == "reservation failure" {
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER reject_reservation BEFORE INSERT ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_reservation()`); err != nil {
					t.Fatal(err)
				}
			}
			id := catalog.Items[1].ID
			if scenario == "referenced" {
				id = catalog.Items[0].ID
			}
			s := application.New(store, fixedClock{time.Now().UTC().Truncate(time.Millisecond)}, ids{})
			_, err := s.DeleteInventoryItem(ctx, channel, id)
			if (err == nil) != (scenario == "success") {
				t.Fatal("unexpected deletion result", err)
			}
			rpRead(t, store, func(r application.Repository) error {
				view, err := r.GetCardView(ctx, channel, application.CardInventory, channel)
				if err != nil {
					return err
				}
				wantMode, wantCount := application.CardDeleteSelection, 2
				if scenario == "success" {
					wantMode, wantCount = application.CardNormal, 1
				}
				if view.Mode != wantMode {
					t.Fatalf("want mode %s got %s", wantMode, view.Mode)
				}
				stored, err := r.GetCatalog(ctx, channel, false)
				if err != nil {
					return err
				}
				if len(stored.Items) != wantCount {
					t.Fatal("inventory rollback mismatch", len(stored.Items))
				}
				return nil
			})
		})
	}
}
