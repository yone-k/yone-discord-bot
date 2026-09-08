//go:build integration

package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestResolveInventoryOnlyReservesOutputWhenCreating(t *testing.T) {
	db, store := rpSetup(t)
	catalog, _, _ := rpSeedCatalogTask(t, store)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: "InventoryUpdateModalHandler"})
	if err != nil {
		t.Fatal(err)
	}
	s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
	if _, err := s.ResolveInventory(ctx, catalog.Channel.ChannelID, catalog.Items[0].Name); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM output_tasks").Scan(&count); err != nil || count != 0 {
		t.Fatal("lookup reserved output", count, err)
	}
	created, err := s.ResolveInventory(ctx, catalog.Channel.ChannelID, "新しい在庫")
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "新しい在庫" {
		t.Fatal(created)
	}
	rpRead(t, store, func(r application.Repository) error {
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{})
		if err != nil {
			return err
		}
		if len(jobs) != 2 {
			t.Fatalf("want inventory and linked task cards, got %d", len(jobs))
		}
		return nil
	})
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != 1 {
		t.Fatal("creation operation count", count, err)
	}
}

func TestTaskReorderReservesAllCardsWithOneOperation(t *testing.T) {
	db, store := rpSetup(t)
	_, ch, first := rpSeedCatalogTask(t, store)
	second := *first
	var err error
	second.ID, err = (ids{}).NewID()
	if err != nil {
		t.Fatal(err)
	}
	second.EntityID = second.ID
	second.MessageID = nil
	second.InventoryItems = nil
	second.Position = 1
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutTask(t.Context(), &second, ch.LinkedInventoryChannelID, true)
	})
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: "RemindTaskUpdateModalHandler"})
	if err != nil {
		t.Fatal(err)
	}
	s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
	if _, err := s.ReorderTasks(ctx, ch.ChannelID, []string{second.ID, first.ID}); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: ch.ChannelID})
		if err != nil {
			return err
		}
		cards, logs := 0, 0
		for _, job := range jobs {
			if job.Kind == application.OutputTaskCard {
				cards++
				if job.OperationID == "" {
					t.Fatal("card has no operation")
				}
			} else if job.Kind == application.OutputOperationLog {
				logs++
			}
		}
		if cards != 2 || logs != 1 {
			t.Fatalf("want 2 cards and 1 operation log; cards=%d logs=%d", cards, logs)
		}
		return nil
	})
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != 1 {
		t.Fatal("reorder operation count", count, err)
	}
}

func TestListMutationReservesCardAndOnlyRegisteredOperationLogAtomically(t *testing.T) {
	for _, kind := range []application.OperationKind{"AddListModalHandler", "AddListCommand"} {
		t.Run(string(kind), func(t *testing.T) {
			_, store := rpSetup(t)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: kind, InteractionID: "interaction"})
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			s := application.New(store, fixedClock{now}, ids{})
			rpWrite(t, store, func(r application.Repository) error {
				return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list", OperationLogThreadID: rpPtr("200")}, DefaultCategory: "その他"}})
			})
			if _, err := s.AppendListItem(ctx, "100", domain.ListItem{Name: "牛乳"}); err != nil {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: "100"})
				if err != nil {
					return err
				}
				want := 1
				if kind == "AddListModalHandler" {
					want = 2
				}
				if len(jobs) != want {
					t.Fatalf("output count: want %d got %d", want, len(jobs))
				}
				var card *application.OutputTask
				for i := range jobs {
					if jobs[i].Kind == application.OutputListRender {
						card = &jobs[i]
					}
				}
				if card == nil || card.OperationID == "" {
					t.Fatal("card missing operation record")
				}
				op, err := r.GetOperation(ctx, card.OperationID)
				if err != nil {
					return err
				}
				if op == nil || !op.Success || op.ActorID != "123" || op.Kind != kind {
					t.Fatal("incorrect operation", op)
				}
				if kind == "AddListModalHandler" {
					if len(op.Facts.Added) != 1 || op.Facts.Added[0].Name != "牛乳" {
						t.Fatal("added item missing from persisted operation", op.Facts)
					}
				} else if len(op.Facts.Added) != 0 {
					t.Fatal("unrelated command gained log details", op.Facts)
				}
				return nil
			})
		})
	}
}

func TestListMutationRollsBackWhenOutputReservationFails(t *testing.T) {
	db, store := rpSetup(t)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: "AddListModalHandler"})
	if err != nil {
		t.Fatal(err)
	}
	s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list"}, DefaultCategory: "その他"}})
	})
	if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER reject_reservation BEFORE INSERT ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_reservation()`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendListItem(ctx, "100", domain.ListItem{Name: "牛乳"}); err == nil {
		t.Fatal("business succeeded without reserving output")
	}
	rpRead(t, store, func(r application.Repository) error {
		list, err := r.GetList(ctx, "100", false)
		if err != nil {
			return err
		}
		if len(list.Items) != 0 {
			t.Fatal("business escaped failed outbox transaction")
		}
		return nil
	})
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != 0 {
		t.Fatal("success operation escaped rollback", count, err)
	}
}

func TestInventoryMutationReservesLinkedCardsWithoutDiscordLog(t *testing.T) {
	_, store := rpSetup(t)
	catalog, _, task := rpSeedCatalogTask(t, store)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: "InventoryUpdateModalHandler", InteractionID: "inventory-update"})
	if err != nil {
		t.Fatal(err)
	}
	s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
	catalog.Items[0].Stock = rpQuantity(t, "1.25")
	if _, err := s.UpdateInventoryItems(ctx, catalog.Channel.ChannelID, catalog.Items); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{})
		if err != nil {
			return err
		}
		if len(jobs) != 2 {
			t.Fatalf("expected inventory and linked task cards, got %d", len(jobs))
		}
		foundInventory, foundTask := false, false
		for _, job := range jobs {
			switch job.Kind {
			case application.OutputInventoryRender:
				foundInventory = job.ChannelID == catalog.Channel.ChannelID
			case application.OutputTaskCard:
				foundTask = job.ChannelID == task.ChannelID && job.TargetID == task.ID
			default:
				t.Fatalf("unexpected output %s", job.Kind)
			}
		}
		if !foundInventory || !foundTask {
			t.Fatal("linked output target missing")
		}
		return nil
	})
}

func TestTaskCreateUpdateDeleteKeepLogsAndDeletionMessageID(t *testing.T) {
	_, store := rpSetup(t)
	ctx := t.Context()
	s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutRemindChannel(ctx, &domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "tasks", OperationLogThreadID: rpPtr("300")}})
	})
	actor := func(kind application.OperationKind) context.Context {
		value, err := application.WithOutputOperation(ctx, application.OutputOperation{ActorID: "123", Kind: kind, InteractionID: string(kind)})
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	task, err := s.CreateTask(actor("RemindTaskAddModalHandler"), "100", application.CreateTaskInput{Title: "task", IntervalDays: 1, TimeOfDay: "12:00", RemindBeforeMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	rpWrite(t, store, func(r application.Repository) error {
		task.MessageID = rpPtr("200")
		return r.PutTask(ctx, task, nil, false)
	})
	if _, err := s.PatchTask(actor("RemindTaskUpdateModalHandler"), "100", task.ID, task.Revision, application.TaskPatch{Title: application.Some("changed")}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteTask(actor("RemindTaskDeleteModalHandler"), "100", task.ID); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		deleted, err := r.GetTask(ctx, "100", task.ID, false)
		if err != nil {
			return err
		}
		if deleted != nil {
			t.Fatal("business task survived deletion")
		}
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: "100"})
		if err != nil {
			return err
		}
		logs, cards, cleanups := 0, 0, 0
		for _, job := range jobs {
			switch job.Kind {
			case application.OutputOperationLog:
				logs++
			case application.OutputTaskCard:
				cards++
				if job.Payload.MessageID == "200" {
					cleanups++
				} else if job.Payload.MessageID != "" {
					t.Fatal("unexpected cleanup ID", job.Payload.MessageID)
				}
			default:
				t.Fatal(job.Kind)
			}
		}
		if logs != 3 || cards != 2 || cleanups != 1 {
			t.Fatalf("want 3 logs, 1 redraw and 1 cleanup: logs=%d cards=%d cleanups=%d", logs, cards, cleanups)
		}
		return nil
	})
}

func TestTaskStockChangesReserveInventoryAndOnePrimaryLog(t *testing.T) {
	for _, kind := range []application.OperationKind{"RemindTaskCompleteModalHandler", "RemindTaskInventoryModalHandler"} {
		t.Run(string(kind), func(t *testing.T) {
			_, store := rpSetup(t)
			catalog, _, task := rpSeedCatalogTask(t, store)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: kind, InteractionID: "task-stock-change"})
			if err != nil {
				t.Fatal(err)
			}
			s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
			if kind == "RemindTaskCompleteModalHandler" {
				_, err = s.CompleteTask(ctx, task.ChannelID, task.ID, task.Revision, nil)
			} else {
				stock := rpQuantity(t, "2.5")
				_, err = s.EditTaskInventory(ctx, task.ChannelID, task.ID, task.Revision, []application.RemindInventoryEdit{{Name: catalog.Items[0].Name, Stock: &stock, Consume: rpQuantity(t, "1")}})
			}
			if err != nil {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				jobs, err := r.ListOutputs(ctx, application.OutputFilter{})
				if err != nil {
					return err
				}
				counts := map[application.OutputKind]int{}
				for _, job := range jobs {
					counts[job.Kind]++
				}
				if counts[application.OutputTaskCard] != 1 || counts[application.OutputInventoryRender] != 1 || counts[application.OutputOperationLog] != 1 || len(jobs) != 3 {
					t.Fatal("incorrect compound output counts", counts)
				}
				return nil
			})
		})
	}
}
