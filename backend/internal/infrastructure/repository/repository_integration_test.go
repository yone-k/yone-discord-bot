//go:build integration

package repository_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/dbtest"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

func rpSetup(t *testing.T) (*sql.DB, *repository.Store) {
	t.Helper()
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	if err := (migration.Runner{Directory: "../../../../db/migrations"}).Apply(t.Context(), db, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(t.Context(), "INSERT INTO data_imports(snapshot_sha256,schema_version,completed_at,report) VALUES(repeat('a',64),1,now(),'{}')"); err != nil {
		t.Fatal(err)
	}
	return db, repository.New(db)
}
func rpID() string { return uuid.Must(uuid.NewV7()).String() }
func rpEqual(t *testing.T, want, got any) {
	t.Helper()
	a, e := json.Marshal(want)
	if e != nil {
		t.Fatal(e)
	}
	b, e := json.Marshal(got)
	if e != nil {
		t.Fatal(e)
	}
	if string(a) != string(b) {
		t.Fatalf("want %s\ngot  %s", a, b)
	}
}
func rpQuantity(t *testing.T, value string) domain.Quantity {
	t.Helper()
	q, e := domain.ParseQuantity(value)
	if e != nil {
		t.Fatal(e)
	}
	return q
}
func rpPtr[T any](v T) *T { return &v }
func rpWrite(t *testing.T, s *repository.Store, fn func(application.Repository) error) {
	t.Helper()
	if e := s.Write(t.Context(), fn); e != nil {
		t.Fatal(e)
	}
}
func rpRead(t *testing.T, s *repository.Store, fn func(application.Repository) error) {
	t.Helper()
	if e := s.Read(t.Context(), fn); e != nil {
		t.Fatal(e)
	}
}

func TestRepositoryListRoundTripNullableOrderingAndVersion(t *testing.T) {
	_, s := rpSetup(t)
	ctx := t.Context()
	now := time.Date(2026, 9, 1, 23, 59, 59, 123000000, time.UTC)
	list := &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", MessageID: rpPtr("101"), ListTitle: "一覧", OperationLogThreadID: rpPtr("102")}, DefaultCategory: "その他", EditVersion: 9007199254740993}, Items: []domain.ListItem{{ID: rpID(), ChannelID: "100", Name: "先", Category: rpPtr("食品"), Until: rpPtr("2026-09-01"), IsCompleted: true, LastNotifiedAt: &now, Position: 0}, {ID: rpID(), ChannelID: "100", Name: "後", Position: 1}}}
	rpWrite(t, s, func(r application.Repository) error { return r.PutList(ctx, list) })
	rpRead(t, s, func(r application.Repository) error {
		got, e := r.GetList(ctx, "100", false)
		if e != nil {
			return e
		}
		rpEqual(t, list, got)
		all, e := r.Lists(ctx)
		if e != nil {
			return e
		}
		rpEqual(t, []domain.ListChannel{list.Channel}, all)
		return nil
	})
	list.Channel.MessageID = nil
	list.Channel.OperationLogThreadID = nil
	list.Channel.EditVersion++
	list.Items[0].Category = nil
	list.Items[0].Until = nil
	list.Items[0].LastNotifiedAt = nil
	list.Items[0], list.Items[1] = list.Items[1], list.Items[0]
	for i := range list.Items {
		list.Items[i].Position = i
	}
	rpWrite(t, s, func(r application.Repository) error {
		if _, e := r.GetList(ctx, "100", true); e != nil {
			return e
		}
		return r.PutList(ctx, list)
	})
	rpRead(t, s, func(r application.Repository) error {
		got, e := r.GetList(ctx, "100", false)
		if e == nil {
			rpEqual(t, list, got)
		}
		return e
	})
	rpWrite(t, s, func(r application.Repository) error {
		list.Items = nil
		if e := r.PutList(ctx, list); e != nil {
			return e
		}
		return r.DeleteList(ctx, "100")
	})
	rpRead(t, s, func(r application.Repository) error {
		got, e := r.GetList(ctx, "100", false)
		if got != nil {
			t.Fatal("deleted list survived")
		}
		return e
	})
}

func rpSeedCatalogTask(t *testing.T, s *repository.Store) (*domain.InventoryCatalog, *domain.RemindChannelSettings, *domain.RemindTask) {
	t.Helper()
	ctx := t.Context()
	now := time.Date(2026, 9, 1, 12, 34, 56, 789000000, time.UTC)
	catalog := &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "200", MessageID: rpPtr("201"), ListTitle: "在庫", OperationLogThreadID: rpPtr("202")}, DefaultCategory: "食品"}, Items: []domain.InventoryItem{{EntityID: rpID(), ID: "旧/任意ID", ChannelID: "200", Name: "米", Stock: rpQuantity(t, "123456789012345678901234567890.00000000000000000001"), Category: rpPtr("食品"), Position: 0}, {EntityID: rpID(), ID: "second", ChannelID: "200", Name: "水", Stock: rpQuantity(t, "0"), Position: 1}}}
	ch := &domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "300", MessageID: rpPtr("301"), ListTitle: "家事", OperationLogThreadID: rpPtr("302")}, RemindNoticeThreadID: rpPtr("303"), RemindNoticeMessageID: rpPtr("304"), LinkedInventoryChannelID: rpPtr("200")}
	task := &domain.RemindTask{EntityID: rpID(), ID: "旧task/任意", ChannelID: "300", MessageID: rpPtr("305"), Title: "炊飯", Description: rpPtr("説明"), IntervalDays: 31, TimeOfDay: "23:59", RemindBeforeMinutes: 10080, StartAt: now, NextDueAt: now, LastDoneAt: &now, LastRemindDueAt: &now, OverdueNotifyCount: 2, OverdueNotifyLimit: rpPtr(3), LastOverdueNotifiedAt: &now, IsPaused: true, CreatedAt: now, UpdatedAt: now, Revision: 9007199254740993, Position: 0, InventoryItems: []domain.InventoryConsumption{{EntityID: rpID(), InventoryID: catalog.Items[0].ID, Consume: rpQuantity(t, "0.00000000000000000001")}}}
	rpWrite(t, s, func(r application.Repository) error {
		if e := r.PutCatalog(ctx, catalog); e != nil {
			return e
		}
		if e := r.PutRemindChannel(ctx, ch); e != nil {
			return e
		}
		return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, true)
	})
	return catalog, ch, task
}

func TestRepositoryInventoryAndReminderPreserveLegacyIDsPrecisionNullsAndReferences(t *testing.T) {
	_, s := rpSetup(t)
	ctx := t.Context()
	catalog, ch, task := rpSeedCatalogTask(t, s)
	verify := func() {
		rpRead(t, s, func(r application.Repository) error {
			got, e := r.GetCatalog(ctx, "200", false)
			if e != nil {
				return e
			}
			rpEqual(t, catalog, got)
			for i := range got.Items {
				if got.Items[i].Stock.String() != catalog.Items[i].Stock.String() {
					t.Fatal("quantity precision lost")
				}
			}
			gotTask, e := r.GetTask(ctx, "300", task.ID, false)
			if e != nil {
				return e
			}
			rpEqual(t, task, gotTask)
			if gotTask.InventoryItems[0].Consume.String() != task.InventoryItems[0].Consume.String() {
				t.Fatal("consume precision lost")
			}
			all, e := r.Tasks(ctx, "300", false)
			if e != nil {
				return e
			}
			rpEqual(t, []domain.RemindTask{*task}, all)
			gotCh, e := r.GetRemindChannel(ctx, "300", false)
			if e != nil {
				return e
			}
			rpEqual(t, ch, gotCh)
			return nil
		})
	}
	verify()
	catalog.Items[0].Name, catalog.Items[1].Name = catalog.Items[1].Name, catalog.Items[0].Name
	catalog.Items[0].Category = nil
	catalog.Channel.MessageID = nil
	catalog.Channel.OperationLogThreadID = nil
	task.Description = nil
	task.MessageID = nil
	task.LastDoneAt = nil
	task.LastRemindDueAt = nil
	task.LastOverdueNotifiedAt = nil
	task.OverdueNotifyLimit = nil
	task.Revision++
	task.TimeOfDay = "00:00"
	task.IsPaused = false
	ch.MessageID = nil
	ch.OperationLogThreadID = nil
	ch.RemindNoticeThreadID = nil
	ch.RemindNoticeMessageID = nil
	rpWrite(t, s, func(r application.Repository) error {
		if _, e := r.GetRemindChannel(ctx, "300", true); e != nil {
			return e
		}
		if _, e := r.GetTask(ctx, "300", task.ID, true); e != nil {
			return e
		}
		if _, e := r.GetCatalog(ctx, "200", true); e != nil {
			return e
		}
		if e := r.PutCatalog(ctx, catalog); e != nil {
			return e
		}
		if e := r.PutRemindChannel(ctx, ch); e != nil {
			return e
		}
		return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false)
	})
	verify()
	// The same legacy text ID is legal in another channel and stays independently addressable.
	other := &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "210", ListTitle: "別在庫"}, DefaultCategory: "その他"}, Items: []domain.InventoryItem{{EntityID: rpID(), ID: catalog.Items[0].ID, ChannelID: "210", Name: "別", Stock: rpQuantity(t, "7"), Position: 0}}}
	rpWrite(t, s, func(r application.Repository) error { return r.PutCatalog(ctx, other) })
	rpRead(t, s, func(r application.Repository) error {
		got, e := r.GetCatalog(ctx, "210", false)
		if e == nil {
			rpEqual(t, other, got)
		}
		return e
	})
	rpWrite(t, s, func(r application.Repository) error {
		if e := r.DeleteTask(ctx, "300", task.ID); e != nil {
			return e
		}
		ch.LinkedInventoryChannelID = nil
		if e := r.PutRemindChannel(ctx, ch); e != nil {
			return e
		}
		if e := r.DeleteRemindChannel(ctx, "300"); e != nil {
			return e
		}
		catalog.Items = nil
		if e := r.PutCatalog(ctx, catalog); e != nil {
			return e
		}
		return r.DeleteCatalog(ctx, "200")
	})
}

func TestRepositoryFailuresRollbackAllWritesAndMapDeferredConstraints(t *testing.T) {
	_, s := rpSetup(t)
	ctx := t.Context()
	catalog, ch, task := rpSeedCatalogTask(t, s)
	abort := errors.New("abort unit of work")
	err := s.Write(ctx, func(r application.Repository) error {
		catalog.Items[0].Stock = rpQuantity(t, "1")
		if e := r.PutCatalog(ctx, catalog); e != nil {
			return e
		}
		task.Revision++
		if e := r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false); e != nil {
			return e
		}
		return abort
	})
	if !errors.Is(err, abort) {
		t.Fatal(err)
	}
	rpRead(t, s, func(r application.Repository) error {
		c, e := r.GetCatalog(ctx, "200", false)
		if e != nil {
			return e
		}
		if c.Items[0].Stock.String() == "1" {
			t.Fatal("stock escaped rollback")
		}
		got, e := r.GetTask(ctx, "300", task.ID, false)
		if e != nil {
			return e
		}
		if got.Revision == task.Revision {
			t.Fatal("task escaped rollback")
		}
		return nil
	})
	err = s.Write(ctx, func(r application.Repository) error { catalog.Items[1].Position = 0; return r.PutCatalog(ctx, catalog) })
	var d *domain.Error
	if !errors.As(err, &d) || d.Code != "conflict" {
		t.Fatal("deferred uniqueness was not mapped", err)
	}
	err = s.Write(ctx, func(r application.Repository) error {
		catalog.Items = catalog.Items[1:]
		catalog.Items[0].Position = 0
		return r.PutCatalog(ctx, catalog)
	})
	if !errors.As(err, &d) || d.Code != "referenced" {
		t.Fatal("reference was not mapped", err)
	}
	err = s.Read(ctx, func(r application.Repository) error {
		ch.ListTitle = "read-only mutation"
		return r.PutRemindChannel(ctx, ch)
	})
	if err == nil {
		t.Fatal("read callback wrote data")
	}
}

func TestRepositoryLockingReadsRetainDatabaseRowLocks(t *testing.T) {
	db, s := rpSetup(t)
	ctx := t.Context()
	_, _, task := rpSeedCatalogTask(t, s)
	rpWrite(t, s, func(r application.Repository) error {
		if _, e := r.GetRemindChannel(ctx, "300", true); e != nil {
			return e
		}
		if _, e := r.GetTask(ctx, "300", task.ID, true); e != nil {
			return e
		}
		if _, e := r.GetCatalog(ctx, "200", true); e != nil {
			return e
		}
		conn, e := db.Conn(ctx)
		if e != nil {
			return e
		}
		defer conn.Close()
		if _, e = conn.ExecContext(ctx, "SET lock_timeout='100ms'"); e != nil {
			return e
		}
		defer conn.ExecContext(context.Background(), "SET lock_timeout=0")
		for _, query := range []string{"UPDATE remind_channels SET list_title=list_title WHERE channel_id='300'", "UPDATE remind_tasks SET revision=revision WHERE channel_id='300'", "UPDATE inventory_channels SET list_title=list_title WHERE channel_id='200'", "UPDATE inventory_items SET stock=stock WHERE channel_id='200'"} {
			_, err := conn.ExecContext(ctx, query)
			var pg *pgconn.PgError
			if !errors.As(err, &pg) || pg.Code != "55P03" {
				t.Fatalf("row lock not held: %s: %v", query, err)
			}
		}
		return nil
	})
}

func TestRepositoryReadUsesOneRepeatableSnapshot(t *testing.T) {
	_, s := rpSetup(t)
	ctx := t.Context()
	catalog, _, _ := rpSeedCatalogTask(t, s)
	rpRead(t, s, func(r application.Repository) error {
		before, err := r.GetCatalog(ctx, "200", false)
		if err != nil {
			return err
		}
		catalog.Items[0].Stock = rpQuantity(t, "5")
		rpWrite(t, s, func(writer application.Repository) error { return writer.PutCatalog(ctx, catalog) })
		after, err := r.GetCatalog(ctx, "200", false)
		if err != nil {
			return err
		}
		if before.Items[0].Stock.String() != after.Items[0].Stock.String() {
			t.Fatal("read observed multiple snapshots")
		}
		return nil
	})
	rpRead(t, s, func(r application.Repository) error {
		after, err := r.GetCatalog(ctx, "200", false)
		if err == nil && after.Items[0].Stock.String() != "5" {
			t.Fatal("new snapshot missed committed write")
		}
		return err
	})
}

func TestRepositoryTaskReferencesReplaceAtomicallyAndLegacyIDsAreChannelScoped(t *testing.T) {
	_, s := rpSetup(t)
	ctx := t.Context()
	catalog, ch, task := rpSeedCatalogTask(t, s)
	second := *ch
	second.ChannelID = "310"
	copyTask := *task
	copyTask.ChannelID = second.ChannelID
	copyTask.EntityID = rpID()
	copyTask.InventoryItems = []domain.InventoryConsumption{}
	rpWrite(t, s, func(r application.Repository) error {
		if err := r.PutRemindChannel(ctx, &second); err != nil {
			return err
		}
		return r.PutTask(ctx, &copyTask, second.LinkedInventoryChannelID, true)
	})
	task.InventoryItems = []domain.InventoryConsumption{
		{EntityID: rpID(), InventoryID: catalog.Items[1].ID, Consume: rpQuantity(t, "0")},
		{EntityID: rpID(), InventoryID: catalog.Items[0].ID, Consume: rpQuantity(t, "0.001")},
	}
	rpWrite(t, s, func(r application.Repository) error { return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, true) })
	rpRead(t, s, func(r application.Repository) error {
		got, err := r.GetTask(ctx, "300", task.ID, false)
		if err != nil {
			return err
		}
		rpEqual(t, task, got)
		got, err = r.GetTask(ctx, "310", task.ID, false)
		if err != nil {
			return err
		}
		rpEqual(t, &copyTask, got)
		channels, err := r.RemindChannels(ctx)
		if err != nil {
			return err
		}
		rpEqual(t, []domain.RemindChannelSettings{*ch, second}, channels)
		catalogs, err := r.Catalogs(ctx)
		if err != nil {
			return err
		}
		rpEqual(t, []domain.InventoryChannel{catalog.Channel}, catalogs)
		return nil
	})
	before := append([]domain.InventoryConsumption(nil), task.InventoryItems...)
	task.InventoryItems = []domain.InventoryConsumption{{EntityID: rpID(), InventoryID: "missing", Consume: rpQuantity(t, "1")}}
	err := s.Write(ctx, func(r application.Repository) error { return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, true) })
	var d *domain.Error
	if !errors.As(err, &d) || d.Code != "referenced" {
		t.Fatal(err)
	}
	rpRead(t, s, func(r application.Repository) error {
		got, err := r.GetTask(ctx, "300", task.ID, false)
		if err == nil {
			rpEqual(t, before, got.InventoryItems)
		}
		return err
	})
}
