//go:build integration

package repository_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/dbtest"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

type fixedClock struct{ now time.Time }

func (c fixedClock) Now() time.Time { return c.now }

type ids struct{}

func (ids) NewID() (string, error) { id, e := uuid.NewV7(); return id.String(), e }
func q(t *testing.T, s string) domain.Quantity {
	t.Helper()
	v, e := domain.ParseQuantity(s)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func code(t *testing.T, e error, want string) {
	t.Helper()
	var d *domain.Error
	if !errors.As(e, &d) || string(d.Code) != want {
		t.Fatalf("want %s, got %v", want, e)
	}
}
func setup(t *testing.T) *application.Service {
	t.Helper()
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	if e := (migration.Runner{Directory: "../../../../db/migrations"}).Apply(context.Background(), db, ""); e != nil {
		t.Fatal(e)
	}
	return application.New(repository.New(db), fixedClock{time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)}, ids{})
}

func persistTaskMessage(t *testing.T, task domain.RemindTask, messageID string) *domain.RemindTask {
	t.Helper()
	store := repository.New(dbtest.Open(t))
	rpWrite(t, store, func(r application.Repository) error {
		channel, err := r.GetRemindChannel(t.Context(), task.ChannelID, true)
		if err != nil {
			return err
		}
		task.MessageID = &messageID
		return r.PutTask(t.Context(), &task, channel.LinkedInventoryChannelID, false)
	})
	return &task
}

func TestNewServiceEntitiesPersistUUIDv7AsBothIdentifiers(t *testing.T) {
	s := setup(t)
	db := dbtest.Open(t)
	ctx := context.Background()
	if _, err := s.SaveInventoryChannel(ctx, domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "2", ListTitle: "inventory"}, DefaultCategory: "other"}); err != nil {
		t.Fatal(err)
	}
	appended, err := s.AppendInventoryItem(ctx, "2", domain.InventoryItem{Name: "appended", Stock: q(t, "1.234")})
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := s.GetCatalog(ctx, "2")
	if err != nil {
		t.Fatal(err)
	}
	items := append(append([]domain.InventoryItem(nil), catalog.Items...), domain.InventoryItem{Name: "applied", Stock: q(t, "0.0001")})
	applied, err := s.ApplyInventory(ctx, "2", catalog.Items, items)
	if err != nil || len(applied) != 2 {
		t.Fatalf("new apply item failed: %v", err)
	}
	if _, err := s.SaveRemindChannel(ctx, domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "3", ListTitle: "tasks"}}); err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTask(ctx, "3", application.CreateTaskInput{Title: "created", IntervalDays: 1, TimeOfDay: "09:00"})
	if err != nil {
		t.Fatal(err)
	}
	for _, entity := range []struct{ table, channel, id, entityID string }{
		{"inventory_items", "2", appended.ID, appended.EntityID},
		{"inventory_items", "2", applied[1].ID, applied[1].EntityID},
		{"remind_tasks", "3", task.ID, task.EntityID},
	} {
		id, err := uuid.Parse(entity.id)
		if err != nil || id.Version() != 7 || entity.id != entity.entityID {
			t.Fatalf("service did not allocate one UUIDv7 identity: %#v, %v", entity, err)
		}
		var storedID, storedEntityID string
		query := fmt.Sprintf("SELECT id, entity_id::text FROM %s WHERE channel_id=$1 AND id=$2", entity.table)
		if err := db.QueryRowContext(ctx, query, entity.channel, entity.id).Scan(&storedID, &storedEntityID); err != nil {
			t.Fatal(err)
		}
		if storedID != entity.id || storedEntityID != entity.id {
			t.Fatalf("persisted identity differs from response: %s / %s / %s", entity.id, storedID, storedEntityID)
		}
	}
}
func TestAtomicCompletionAndOptimisticRevision(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, e := s.SaveInventoryChannel(ctx, domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "2", ListTitle: "stock"}, DefaultCategory: "other"})
	if e != nil {
		t.Fatal(e)
	}
	linked := "2"
	_, e = s.SaveRemindChannel(ctx, domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "3", ListTitle: "tasks"}, LinkedInventoryChannelID: &linked})
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.AppendInventoryItem(ctx, "2", domain.InventoryItem{Name: "A", Stock: q(t, "9007199254740993.123456789")})
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.AppendInventoryItem(ctx, "2", domain.InventoryItem{Name: "B", Stock: q(t, "0.1")})
	if e != nil {
		t.Fatal(e)
	}
	task, e := s.CreateTask(ctx, "3", application.CreateTaskInput{Title: "task", IntervalDays: 1, TimeOfDay: "21:00", InventoryItems: []domain.InventoryConsumption{{InventoryID: a.ID, Consume: q(t, "0.000000001")}, {InventoryID: b.ID, Consume: q(t, "1")}}})
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.CompleteTask(ctx, "3", task.ID, task.Revision, nil)
	code(t, e, "shortage")
	current, e := s.GetCatalog(ctx, "2")
	if e != nil {
		t.Fatal(e)
	}
	if current.Items[0].Stock.String() != a.Stock.String() {
		t.Fatal("partial consumption escaped rollback")
	}
	completed, e := s.CompleteTask(ctx, "3", task.ID, task.Revision, []application.ConsumptionOverride{{Name: "B", Consume: ptr(q(t, "0.1"))}})
	if e != nil {
		t.Fatal(e)
	}
	if completed.Revision != task.Revision+1 {
		t.Fatal("revision not advanced")
	}
	current, e = s.GetCatalog(ctx, "2")
	if e != nil {
		t.Fatal(e)
	}
	if current.Items[0].Stock.String() != "9007199254740993.123456788" {
		t.Fatal("decimal precision lost")
	}
	_, e = s.CompleteTask(ctx, "3", task.ID, task.Revision, nil)
	code(t, e, "conflict")
}
func ptr[T any](v T) *T { return &v }

func inventoryFixture(t *testing.T, s *application.Service) (domain.InventoryItem, domain.InventoryItem, domain.RemindTask) {
	t.Helper()
	ctx := context.Background()
	if _, e := s.SaveInventoryChannel(ctx, domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "2", ListTitle: "stock"}, DefaultCategory: "other"}); e != nil {
		t.Fatal(e)
	}
	if _, e := s.SaveRemindChannel(ctx, domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "3", ListTitle: "tasks"}, LinkedInventoryChannelID: ptr("2")}); e != nil {
		t.Fatal(e)
	}
	a, e := s.AppendInventoryItem(ctx, "2", domain.InventoryItem{Name: "A", Stock: q(t, "1.234")})
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.AppendInventoryItem(ctx, "2", domain.InventoryItem{Name: "B", Stock: q(t, "2")})
	if e != nil {
		t.Fatal(e)
	}
	task, e := s.CreateTask(ctx, "3", application.CreateTaskInput{Title: "task", IntervalDays: 1, TimeOfDay: "21:00", RemindBeforeMinutes: 1440, InventoryItems: []domain.InventoryConsumption{{InventoryID: a.ID, Consume: q(t, "0.0123")}}})
	if e != nil {
		t.Fatal(e)
	}
	return *a, *b, *task
}

func TestListSnapshotConflictAndNotificationPreservation(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, e := s.SaveListChannel(ctx, domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "1", ListTitle: "list", OperationLogThreadID: ptr("9")}, DefaultCategory: "other"})
	if e != nil {
		t.Fatal(e)
	}
	item, e := s.AppendListItem(ctx, "1", domain.ListItem{Name: "today", Until: ptr("2026-09-05")})
	if e != nil {
		t.Fatal(e)
	}
	if id, e := uuid.Parse(item.ID); e != nil || id.Version() != 7 {
		t.Fatal("new list ID must be v7")
	}
	before, e := s.GetList(ctx, "1")
	if e != nil {
		t.Fatal(e)
	}
	plan, e := s.PollNotifications(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if len(plan.Notifications) != 1 {
		t.Fatalf("expected list notice, got %#v", plan)
	}
	ack, e := s.AckNotification(ctx, plan.Notifications[0].NotificationToken)
	if e != nil {
		t.Fatal(e)
	}
	if ack.Item.LastNotifiedAt == nil {
		t.Fatal("notification not recorded")
	}
	saved, e := s.SaveList(ctx, "1", before.Channel.EditVersion, []domain.ListItem{{Name: "today", Until: ptr("2026-09-05"), Category: ptr("C")}})
	if e != nil {
		t.Fatal(e)
	}
	if saved.Items[0].ID != item.ID || saved.Items[0].LastNotifiedAt == nil {
		t.Fatal("save lost identity/notice")
	}
	_, e = s.SaveList(ctx, "1", before.Channel.EditVersion, nil)
	code(t, e, "conflict")
	_, e = s.AckNotification(ctx, plan.Notifications[0].NotificationToken)
	if e != nil {
		t.Fatal("same day list ack must be idempotent", e)
	}
	rpWrite(t, repository.New(dbtest.Open(t)), func(r application.Repository) error {
		list, err := r.GetList(ctx, "1", true)
		if err != nil {
			return err
		}
		list.Channel.MessageID = ptr("88")
		return r.PutList(ctx, list)
	})
	changed, e := s.GetListChannel(ctx, "1")
	if e != nil {
		t.Fatal(e)
	}
	if changed.EditVersion != saved.Channel.EditVersion {
		t.Fatal("message redraw invalidated editor")
	}
	changed, e = s.PatchListChannel(ctx, "1", application.ChannelPatch{ListTitle: application.Some("new")})
	if e != nil {
		t.Fatal(e)
	}
	if changed.EditVersion != saved.Channel.EditVersion+1 {
		t.Fatal("business settings did not invalidate editor")
	}
}

func TestInventoryApplyRenameReorderAndReferencedDeletion(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	a, b, _ := inventoryFixture(t, s)
	catalog, e := s.GetCatalog(ctx, "2")
	if e != nil {
		t.Fatal(e)
	}
	items := append([]domain.InventoryItem(nil), catalog.Items...)
	items[0].Name = "B"
	items[1].Name = "A"
	saved, e := s.ApplyInventory(ctx, "2", catalog.Items, items)
	if e != nil {
		t.Fatal(e)
	}
	if saved[0].ID != a.ID || saved[1].ID != b.ID || saved[0].Name != "B" {
		t.Fatal("rename lost IDs")
	}
	_, e = s.ApplyInventory(ctx, "2", catalog.Items, items)
	code(t, e, "conflict")
	_, e = s.DeleteInventoryItem(ctx, "2", a.ID)
	code(t, e, "referenced")
	var detail *application.OperationError
	if !errors.As(e, &detail) || len(detail.References) != 1 {
		t.Fatal("referencing task detail missing")
	}
	_, e = s.ReorderInventory(ctx, "2", []string{a.ID})
	code(t, e, "invalid_input")
	reordered, e := s.ReorderInventory(ctx, "2", []string{b.ID, a.ID})
	if e != nil {
		t.Fatal(e)
	}
	if reordered[0].ID != b.ID {
		t.Fatal("reorder failed")
	}
}

func TestTaskSettingsAreAtomicAndMessagePersistenceKeepsReferences(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, _, task := inventoryFixture(t, s)
	updated, e := s.EditTaskInventory(ctx, "3", task.ID, task.Revision, []application.RemindInventoryEdit{{Name: "A", Stock: ptr(q(t, "1.234")), Consume: q(t, "0.0123")}})
	if e != nil {
		t.Fatal(e)
	}
	if updated.StockChanged || updated.Task.InventoryItems[0].Consume.String() != "0.0123" {
		t.Fatal("untouched precision changed")
	}
	_, e = s.EditTaskInventory(ctx, "3", task.ID, task.Revision, []application.RemindInventoryEdit{{Name: "new", Stock: ptr(q(t, "99")), Consume: q(t, "1")}})
	code(t, e, "conflict")
	c, e := s.GetCatalog(ctx, "2")
	if e != nil {
		t.Fatal(e)
	}
	if len(c.Items) != 2 {
		t.Fatal("stale settings created inventory")
	}
	db := dbtest.Open(t)
	_, e = db.ExecContext(ctx, `CREATE FUNCTION reject_reference_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reference writes forbidden'; END $$; CREATE TRIGGER reject_reference_write BEFORE INSERT OR UPDATE OR DELETE ON remind_task_inventory_items FOR EACH ROW EXECUTE FUNCTION reject_reference_write()`)
	if e != nil {
		t.Fatal(e)
	}
	persistTaskMessage(t, updated.Task, "55")
	patched, e := s.GetTask(ctx, "3", task.ID)
	if e != nil {
		t.Fatal(e)
	}
	if patched.MessageID == nil || *patched.MessageID != "55" || patched.InventoryItems[0].Consume.String() != "0.0123" {
		t.Fatal("message persistence changed business settings")
	}
}

func TestTaskTimeEditKeepsDeadlineAndOverrideResetsNotification(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, _, task := inventoryFixture(t, s)
	patched, e := s.PatchTask(ctx, "3", task.ID, task.Revision, application.TaskPatch{TimeOfDay: application.Some("08:15"), IntervalDays: application.Some(2)})
	if e != nil {
		t.Fatal(e)
	}
	if !patched.NextDueAt.Equal(task.NextDueAt) || patched.StartAt.Equal(task.StartAt) {
		t.Fatal("time edit must change start only")
	}
	_, e = s.PatchTask(ctx, "3", task.ID, patched.Revision, application.TaskPatch{LastDoneAt: application.Some(ptr(task.NextDueAt.Add(time.Hour)))})
	code(t, e, "invalid_input")
	at := task.NextDueAt.Add(-time.Hour)
	patched, e = s.PatchTask(ctx, "3", task.ID, patched.Revision, application.TaskPatch{LastDoneAt: application.Some(&at)})
	if e != nil {
		t.Fatal(e)
	}
	if patched.LastDoneAt == nil || !patched.LastDoneAt.Equal(at) {
		t.Fatal("manual date was not persisted")
	}
}

func TestReminderAckConflictsAndReturnsLatestRevision(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, _, task := inventoryFixture(t, s)
	taskPtr := persistTaskMessage(t, task, "55")
	plan, e := s.PollNotifications(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if len(plan.Notifications) != 1 || plan.Notifications[0].Kind != "before" {
		t.Fatalf("expected reminder: %#v", plan)
	}
	ack, e := s.AckNotification(ctx, plan.Notifications[0].NotificationToken)
	if e != nil {
		t.Fatal(e)
	}
	if ack.Task == nil || ack.Task.Revision != taskPtr.Revision+1 {
		t.Fatal("ack did not return latest revision")
	}
	_, e = s.AckNotification(ctx, plan.Notifications[0].NotificationToken)
	code(t, e, "conflict")
	again, e := s.PollNotifications(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if len(again.Notifications) != 0 || len(again.Progress) != 1 {
		t.Fatal("acknowledged task must only be progress at minute zero")
	}
}

// Issue #41 makes rounding presentation-only, including newly edited settings.
func TestInventorySettingsPreserveNewDecimalInputsWithoutPresentationRounding(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, _, task := inventoryFixture(t, s)
	result, err := s.EditTaskInventory(ctx, "3", task.ID, task.Revision, []application.RemindInventoryEdit{
		{Name: "A", Stock: ptr(q(t, "1.234")), Consume: q(t, "0.26")},
		{Name: "new", Stock: ptr(q(t, "2.26")), Consume: q(t, "1.16")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Task.InventoryItems[0].Consume.String() != "0.26" || result.Task.InventoryItems[1].Consume.String() != "1.16" {
		t.Fatal("settings were rounded as presentation data")
	}
	item, err := s.GetInventoryByName(ctx, "2", "new")
	if err != nil {
		t.Fatal(err)
	}
	if item.Stock.String() != "2.26" {
		t.Fatal("new stock was rounded")
	}
}

func TestConcurrentEqualVersionSavesAllowExactlyOneWriter(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, err := s.SaveListChannel(ctx, domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "1", ListTitle: "list"}, DefaultCategory: "other"})
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 2)
	for _, name := range []string{"A", "B"} {
		go func(name string) { _, err := s.SaveList(ctx, "1", 0, []domain.ListItem{{Name: name}}); results <- err }(name)
	}
	winners := 0
	for range 2 {
		if err := <-results; err == nil {
			winners++
		} else {
			code(t, err, "conflict")
		}
	}
	if winners != 1 {
		t.Fatalf("expected one writer, got %d", winners)
	}
}

func TestLateDatabaseFailureRollsBackInventoryAndTaskTogether(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	a, _, task := inventoryFixture(t, s)
	db := dbtest.Open(t)
	_, err := db.ExecContext(ctx, `CREATE FUNCTION reject_task_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER reject_task_write BEFORE UPDATE ON remind_tasks FOR EACH ROW EXECUTE FUNCTION reject_task_write()`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CompleteTask(ctx, "3", task.ID, task.Revision, nil); err == nil {
		t.Fatal("synthetic task failure not propagated")
	}
	stored, err := s.GetInventoryItem(ctx, "2", a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Stock.Compare(a.Stock) != 0 {
		t.Fatal("inventory committed before failed task update")
	}
	current, err := s.GetTask(ctx, "3", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Revision != task.Revision || current.LastDoneAt != nil {
		t.Fatal("failed completion changed task")
	}
}

func TestTaskInventoryEditRollsBackEarlyStockChangeOnLateFailure(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	a, _, task := inventoryFixture(t, s)
	db := dbtest.Open(t)
	if _, err := db.ExecContext(ctx, `ALTER TABLE inventory_items ADD CONSTRAINT reject_name CHECK(name<>'rejected')`); err != nil {
		t.Fatal(err)
	}
	_, err := s.EditTaskInventory(ctx, "3", task.ID, task.Revision, []application.RemindInventoryEdit{{Name: "A", Stock: ptr(q(t, "99")), Consume: q(t, "1")}, {Name: "rejected", Stock: ptr(q(t, "5")), Consume: q(t, "1")}})
	if err == nil {
		t.Fatal("synthetic constraint not propagated")
	}
	stored, err := s.GetInventoryItem(ctx, "2", a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Stock.Compare(a.Stock) != 0 {
		t.Fatal("partial inventory update escaped rollback")
	}
	current, err := s.GetTask(ctx, "3", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Revision != task.Revision {
		t.Fatal("failed settings changed task")
	}
}

func TestLegacyOpaqueIDsRemainUsableThroughService(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, b, task := inventoryFixture(t, s)
	db := dbtest.Open(t)
	legacy := "old arbitrary inventory ID"
	if _, err := db.ExecContext(ctx, "UPDATE inventory_items SET id=$1 WHERE channel_id='2' AND id=$2", legacy, b.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := s.GetInventoryItem(ctx, "2", legacy)
	if err != nil {
		t.Fatal(err)
	}
	if stored.EntityID != b.EntityID {
		t.Fatal("legacy mapping changed internal ID")
	}
	updated, err := s.EditTaskInventory(ctx, "3", task.ID, task.Revision, []application.RemindInventoryEdit{{Name: "B", Consume: q(t, "0.123")}})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Task.InventoryItems[0].InventoryID != legacy {
		t.Fatal("legacy reference was replaced")
	}
	_, err = s.CompleteTask(ctx, "3", task.ID, updated.Task.Revision, nil)
	if err != nil {
		t.Fatal(err)
	}
	stored, err = s.GetInventoryItem(ctx, "2", legacy)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Stock.String() != "1.877" {
		t.Fatal("legacy completion failed")
	}
}

func TestLinkChangeRequiresAllExistingBusinessIDsInTargetCatalog(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	a, _, _ := inventoryFixture(t, s)
	_, err := s.SaveInventoryChannel(ctx, domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "4", ListTitle: "new"}, DefaultCategory: "other"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.LinkInventory(ctx, "3", ptr("4"))
	code(t, err, "referenced")
	_, err = s.LinkInventory(ctx, "3", nil)
	code(t, err, "referenced")
	other, err := s.AppendInventoryItem(ctx, "4", domain.InventoryItem{Name: "different label", Stock: q(t, "9")})
	if err != nil {
		t.Fatal(err)
	}
	db := dbtest.Open(t)
	if _, err = db.ExecContext(ctx, "UPDATE inventory_items SET id=$1 WHERE channel_id='4' AND id=$2", a.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	linked, err := s.LinkInventory(ctx, "3", ptr("4"))
	if err != nil {
		t.Fatal(err)
	}
	if linked.LinkedInventoryChannelID == nil || *linked.LinkedInventoryChannelID != "4" {
		t.Fatal("valid link change failed")
	}
	refs, err := s.InventoryReferences(ctx, "4", a.ID)
	if err != nil || len(refs) != 1 {
		t.Fatal("link cascade did not retain reference")
	}
}

func TestListDuplicateAckDoesNotWriteAgain(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, err := s.SaveListChannel(ctx, domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "1", ListTitle: "list", OperationLogThreadID: ptr("9")}, DefaultCategory: "other"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AppendListItem(ctx, "1", domain.ListItem{Name: "today", Until: ptr("2026-09-05")}); err != nil {
		t.Fatal(err)
	}
	plan, err := s.PollNotifications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AckNotification(ctx, plan.Notifications[0].NotificationToken); err != nil {
		t.Fatal(err)
	}
	db := dbtest.Open(t)
	if _, err = db.ExecContext(ctx, `CREATE FUNCTION reject_list_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'duplicate write'; END $$; CREATE TRIGGER reject_list_write BEFORE UPDATE ON list_items FOR EACH ROW EXECUTE FUNCTION reject_list_write()`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AckNotification(ctx, plan.Notifications[0].NotificationToken); err != nil {
		t.Fatal("duplicate ack must not update database", err)
	}
}

func TestConcurrentCompletionAndAckCannotOverwriteOneAnother(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	a, _, task := inventoryFixture(t, s)
	current := persistTaskMessage(t, task, "55")
	plan, err := s.PollNotifications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 2)
	go func() { _, err := s.CompleteTask(ctx, "3", task.ID, current.Revision, nil); results <- err }()
	go func() { _, err := s.AckNotification(ctx, plan.Notifications[0].NotificationToken); results <- err }()
	winners := 0
	for range 2 {
		if err := <-results; err == nil {
			winners++
		} else {
			code(t, err, "conflict")
		}
	}
	if winners != 1 {
		t.Fatal("exactly one revision writer must commit")
	}
	stored, err := s.GetTask(ctx, "3", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	stock, err := s.GetInventoryItem(ctx, "2", a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != current.Revision+1 {
		t.Fatal("revision advanced more than once")
	}
	if stored.LastDoneAt != nil {
		if stock.Stock.String() != "1.2217" || stored.LastRemindDueAt != nil {
			t.Fatal("completion winner lost atomic state")
		}
	} else if stock.Stock.Compare(a.Stock) != 0 || stored.LastRemindDueAt == nil {
		t.Fatal("ack winner changed inventory")
	}
}

func TestTaskPauseResumeAndReorderPreserveBusinessState(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, _, task := inventoryFixture(t, s)
	paused, err := s.SetTaskPaused(ctx, "3", task.ID, task.Revision, true)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := s.SetTaskPaused(ctx, "3", task.ID, paused.Revision, false)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.IsPaused || !resumed.NextDueAt.Equal(task.NextDueAt) || resumed.InventoryItems[0].Consume.String() != "0.0123" {
		t.Fatal("pause/resume changed task settings")
	}
	other, err := s.CreateTask(ctx, "3", application.CreateTaskInput{Title: "second", IntervalDays: 1, TimeOfDay: "21:00"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.ReorderTasks(ctx, "3", []string{task.ID})
	code(t, err, "invalid_input")
	ordered, err := s.ReorderTasks(ctx, "3", []string{other.ID, task.ID})
	if err != nil {
		t.Fatal(err)
	}
	if ordered[0].ID != other.ID || ordered[1].Revision != resumed.Revision+1 {
		t.Fatal("reorder failed to retain and revise every task")
	}
	if err = s.DeleteTask(ctx, "3", task.ID); err != nil {
		t.Fatal(err)
	}
	catalog, err := s.GetCatalog(ctx, "2")
	if err != nil || len(catalog.Items) != 2 {
		t.Fatal("deleting task removed inventory")
	}
}

type failingIDs struct{}

func (failingIDs) NewID() (string, error) { return "", errors.New("synthetic entropy failure") }
func TestIDGenerationFailurePreventsPersistence(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, _, _ = inventoryFixture(t, s)
	db := dbtest.Open(t)
	broken := application.New(repository.New(db), fixedClock{time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)}, failingIDs{})
	if _, err := broken.AppendInventoryItem(ctx, "2", domain.InventoryItem{Name: "new"}); err == nil {
		t.Fatal("ID failure ignored")
	}
	catalog, err := s.GetCatalog(ctx, "2")
	if err != nil || len(catalog.Items) != 2 {
		t.Fatal("failed ID generation persisted inventory")
	}
	if _, err := broken.CreateTask(ctx, "3", application.CreateTaskInput{Title: "new", IntervalDays: 1, TimeOfDay: "21:00"}); err == nil {
		t.Fatal("task ID failure ignored")
	}
	tasks, err := s.Tasks(ctx, "3")
	if err != nil || len(tasks) != 1 {
		t.Fatal("failed ID generation persisted task")
	}
}

func TestEmptyTaskPatchDoesNotAdvanceRevisionOrWrite(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	_, _, task := inventoryFixture(t, s)
	db := dbtest.Open(t)
	if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_empty_patch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'empty patch write'; END $$; CREATE TRIGGER reject_empty_patch BEFORE UPDATE ON remind_tasks FOR EACH ROW EXECUTE FUNCTION reject_empty_patch()`); err != nil {
		t.Fatal(err)
	}
	got, err := s.PatchTask(ctx, "3", task.ID, task.Revision, application.TaskPatch{})
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != task.Revision {
		t.Fatal("empty patch advanced revision")
	}
}
