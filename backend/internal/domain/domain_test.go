package domain

import (
	"errors"
	"math"
	"testing"
	"time"
)

func TestListMutationsPreserveOrderingAndRejectDuplicates(t *testing.T) {
	l := List{Channel: ListChannel{ChannelSettings: ChannelSettings{ChannelID: "c"}, EditVersion: 1}}
	if e := l.Append(ListItem{ID: "a", Name: "milk"}); e != nil {
		t.Fatal(e)
	}
	if e := l.Append(ListItem{ID: "b", Name: "bread"}); e != nil {
		t.Fatal(e)
	}
	code(t, l.Append(ListItem{ID: "c", Name: "milk"}), "invalid_input")
	code(t, l.Update("missing", ListItem{Name: "x"}), "not_found")
	code(t, l.Update("a", ListItem{Name: "bread"}), "invalid_input")
	if e := l.Update("a", ListItem{Name: "milk", IsCompleted: true}); e != nil {
		t.Fatal(e)
	}
	if e := l.Reorder([]string{"b", "a"}); e != nil {
		t.Fatal(e)
	}
	if l.Items[0].ID != "b" || l.Items[1].Position != 1 || !l.Items[1].IsCompleted || l.Channel.EditVersion != 5 {
		t.Fatal(l)
	}
	code(t, l.Reorder([]string{"a"}), "invalid_input")
	code(t, l.Delete("missing"), "not_found")
	if e := l.Delete("b"); e != nil {
		t.Fatal(e)
	}
	if l.Items[0].ID != "a" || l.Items[0].Position != 1 || l.Channel.EditVersion != 6 {
		t.Fatal(l)
	}
}

func TestListRejectsDifferentChannelAndNotificationDayWithoutMutation(t *testing.T) {
	list := List{Channel: ListChannel{ChannelSettings: ChannelSettings{ChannelID: "1"}, EditVersion: 4}}
	code(t, list.UpdateSettings(ListChannel{ChannelSettings: ChannelSettings{ChannelID: "2"}}), "invalid_input")
	if list.Channel.ChannelID != "1" || list.Channel.EditVersion != 4 {
		t.Fatal("rejected settings mutated the list")
	}
	until := "2026-09-06"
	item := ListItem{ID: "item", Until: &until}
	changed, err := item.MarkNotified(until, instant("2026-09-05T14:59:59Z"))
	code(t, err, "invalid_input")
	if changed || item.LastNotifiedAt != nil {
		t.Fatal("notification on the wrong JST day was recorded")
	}
}
func TestCatalogBulkUpdatesAreAtomic(t *testing.T) {
	c := InventoryCatalog{Channel: InventoryChannel{ChannelSettings: ChannelSettings{ChannelID: "c"}}}
	a := InventoryItem{EntityID: "ea", ID: "a", Name: "milk", Stock: quantity(t, "1")}
	b := InventoryItem{EntityID: "eb", ID: "b", Name: "bread", Stock: quantity(t, "2")}
	if e := c.Append(a); e != nil {
		t.Fatal(e)
	}
	if e := c.Append(b); e != nil {
		t.Fatal(e)
	}
	code(t, c.Append(a), "invalid_input")
	a.Name = "renamed"
	missing := b
	missing.ID = "missing"
	code(t, c.Update([]InventoryItem{a, missing}), "not_found")
	if c.Items[0].Name != "milk" {
		t.Fatal("partial mutation")
	}
	if e := c.Update([]InventoryItem{a}); e != nil {
		t.Fatal(e)
	}
	if e := c.Reorder([]string{"b", "a"}); e != nil {
		t.Fatal(e)
	}
	if c.Items[1].Name != "renamed" || c.Items[1].EntityID != "ea" || c.Items[1].Position != 1 {
		t.Fatal(c)
	}
	code(t, c.Delete("b", true), "referenced")
	if e := c.Delete("b", false); e != nil {
		t.Fatal(e)
	}
	code(t, c.Delete("b", false), "not_found")
	shortages := c.Shortages([]InventoryConsumption{{InventoryID: "a", Consume: quantity(t, "1.01")}, {InventoryID: "missing", Consume: quantity(t, "1")}})
	if len(shortages) != 2 || shortages[0].Available.String() != "1" || shortages[1].Available.String() != "0" {
		t.Fatal(shortages)
	}
	code(t, c.Consume([]InventoryConsumption{{InventoryID: "missing", Consume: Quantity{}}}), "not_found")
}
func TestTaskValidationAndVersionOverflow(t *testing.T) {
	at := instant("2024-01-01T00:00:00Z")
	base := RemindTask{ID: "legacy ID", Title: "task", IntervalDays: 1, TimeOfDay: "09:00", StartAt: at, NextDueAt: at, CreatedAt: at, UpdatedAt: at}
	if e := base.Validate(); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(*RemindTask){func(t *RemindTask) { t.Title = " " }, func(t *RemindTask) { t.IntervalDays = 0 }, func(t *RemindTask) { t.TimeOfDay = "9:00" }, func(t *RemindTask) { t.RemindBeforeMinutes = 10081 }, func(t *RemindTask) { t.OverdueNotifyCount = -1 }, func(t *RemindTask) { t.StartAt = time.Time{} }, func(t *RemindTask) { n := -1; t.OverdueNotifyLimit = &n }, func(t *RemindTask) { t.InventoryItems = []InventoryConsumption{{InventoryID: "a"}, {InventoryID: "a"}} }} {
		task := base
		mutate(&task)
		code(t, task.Validate(), "invalid_input")
	}
	_, e := NextVersion(math.MaxInt64)
	code(t, e, "invalid_input")
	task := base
	task.Revision = math.MaxInt64
	code(t, task.Complete(task.Revision, at, nil, nil), "invalid_input")
	if task.LastDoneAt != nil {
		t.Fatal("overflow mutated task")
	}
	_, e = task.ResolveConsumption([]InventoryConsumption{{InventoryID: "unexpected"}})
	code(t, e, "invalid_input")
}
func TestBeforeAckAndUnknownKind(t *testing.T) {
	due := instant("2024-01-01T00:00:00Z")
	task := RemindTask{Revision: 1, NextDueAt: due, RemindBeforeMinutes: 5}
	code(t, task.MarkNotified(1, due, "unknown", due), "invalid_input")
	if task.Revision != 1 {
		t.Fatal("bad ack mutated")
	}
	if e := task.MarkNotified(1, due, "before", due.Add(-time.Minute)); e != nil {
		t.Fatal(e)
	}
	if task.LastRemindDueAt == nil || !task.LastRemindDueAt.Equal(due) || task.Revision != 2 {
		t.Fatal(task)
	}
	code(t, task.MarkNotified(2, due, "before", due), "conflict")
}

func quantity(t *testing.T, s string) Quantity {
	t.Helper()
	q, e := ParseQuantity(s)
	if e != nil {
		t.Fatal(e)
	}
	return q
}
func instant(s string) time.Time {
	t, e := time.Parse(time.RFC3339, s)
	if e != nil {
		panic(e)
	}
	return t
}
func code(t *testing.T, e error, want string) {
	t.Helper()
	var d *Error
	if !errors.As(e, &d) || string(d.Code) != want {
		t.Fatalf("error %v, want %s", e, want)
	}
}
func TestQuantityPreservesArbitraryPrecision(t *testing.T) {
	a := quantity(t, "0009007199254740993.0000000000000000001")
	b := quantity(t, "0.0000000000000000002")
	if got := a.Add(b).String(); got != "9007199254740993.0000000000000000003" {
		t.Fatal(got)
	}
	c, e := a.Subtract(b)
	if e != nil || c.String() != "9007199254740992.9999999999999999999" {
		t.Fatal(c, e)
	}
	if (Quantity{}).String() != "0" {
		t.Fatal("zero value")
	}
}
func TestQuantityRejectsInvalidAndNegative(t *testing.T) {
	for _, s := range []string{"", "-1", "+1", "1e2", "NaN", "Infinity", "1.", ".1", " 1"} {
		if _, e := ParseQuantity(s); e == nil {
			t.Fatal(s)
		}
	}
	_, e := quantity(t, "1").Subtract(quantity(t, "2"))
	code(t, e, "shortage")
}
func TestScheduleUsesTokyoCalendarAndSkipsPastOccurrences(t *testing.T) {
	now := instant("2024-01-31T15:01:00Z")
	start, e := CalculateStartAt(now, "09:00")
	if e != nil || !start.Equal(instant("2024-02-01T00:00:00Z")) {
		t.Fatal(start, e)
	}
	next, e := CalculateNextDueAt(instant("2024-01-30T00:00:00Z"), 1, "09:00", instant("2024-02-01T00:00:00Z"))
	if e != nil || !next.Equal(instant("2024-02-02T00:00:00Z")) {
		t.Fatal(next, e)
	}
	for _, s := range []string{"24:00", "12:60", "abc"} {
		if _, e := NormalizeTime(s); e == nil {
			t.Fatal(s)
		}
	}
	if s, e := NormalizeTime("9:5"); e != nil || s != "09:05" {
		t.Fatal(s, e)
	}
}

func TestWeeklyScheduleSkipsMultiplePeriodsAcrossLeapDay(t *testing.T) {
	for _, test := range []struct{ now, expected string }{
		{"2024-03-03T23:59:59.999Z", "2024-03-04T00:00:00Z"},
		{"2024-03-04T00:00:00Z", "2024-03-11T00:00:00Z"},
		{"2024-03-04T00:00:00.001Z", "2024-03-11T00:00:00Z"},
	} {
		t.Run(test.now, func(t *testing.T) {
			next, err := CalculateNextDueAt(instant("2024-01-01T00:00:00Z"), 7, "09:00", instant(test.now))
			if err != nil || !next.Equal(instant(test.expected)) {
				t.Fatalf("next=%s err=%v", next, err)
			}
		})
	}
}
func TestNotificationsRespectWindowLimitsAndTokyoDay(t *testing.T) {
	due := instant("2024-02-01T00:00:00Z")
	task := RemindTask{NextDueAt: due, RemindBeforeMinutes: 10}
	if ShouldSendPreReminder(task, due.Add(-10*time.Minute-time.Millisecond)) || !ShouldSendPreReminder(task, due.Add(-10*time.Minute)) || !ShouldSendPreReminder(task, due) || ShouldSendPreReminder(task, due.Add(time.Millisecond)) {
		t.Fatal("window")
	}
	zero := 0
	task.OverdueNotifyLimit = &zero
	if ShouldSendOverdue(task, due.Add(time.Second)) {
		t.Fatal("zero limit")
	}
	task.OverdueNotifyLimit = nil
	last := instant("2024-02-01T14:59:00Z")
	task.LastOverdueNotifiedAt = &last
	if ShouldSendOverdue(task, last) || !ShouldSendOverdue(task, last.Add(time.Minute)) {
		t.Fatal("Tokyo day")
	}
	task.IsPaused = true
	if ShouldSendOverdue(task, last.Add(time.Minute)) {
		t.Fatal("paused")
	}
}
func TestCompletionIsAtomicAndRequiresVariableConsumption(t *testing.T) {
	task := RemindTask{ID: "legacy", Revision: 9007199254740993, IntervalDays: 1, TimeOfDay: "09:00", InventoryItems: []InventoryConsumption{{InventoryID: "a", Consume: Quantity{}}, {InventoryID: "b", Consume: quantity(t, "2")}}}
	stock := InventoryCatalog{Items: []InventoryItem{{ID: "a", Stock: quantity(t, "10")}, {ID: "b", Stock: quantity(t, "1")}}}
	now := instant("2024-02-01T00:00:00Z")
	code(t, task.Complete(task.Revision, now, &stock, nil), "invalid_input")
	code(t, task.Complete(task.Revision, now, &stock, []InventoryConsumption{{InventoryID: "a", Consume: quantity(t, "3")}}), "shortage")
	if stock.Items[0].Stock.String() != "10" || task.LastDoneAt != nil {
		t.Fatal("partial mutation")
	}
	stock.Items[1].Stock = quantity(t, "2")
	if e := task.Complete(task.Revision, now, &stock, []InventoryConsumption{{InventoryID: "a", Consume: quantity(t, "3")}}); e != nil {
		t.Fatal(e)
	}
	if stock.Items[0].Stock.String() != "7" || stock.Items[1].Stock.String() != "0" || task.Revision != 9007199254740994 || !task.NextDueAt.Equal(now.Add(24*time.Hour)) {
		t.Fatal(task, stock)
	}
	code(t, task.Complete(task.Revision-1, now, &stock, nil), "conflict")
}
func TestAckRejectsDuplicateAndDifferentDeadline(t *testing.T) {
	due := instant("2024-02-01T00:00:00Z")
	task := RemindTask{ID: "task", Revision: 1, NextDueAt: due}
	if e := task.MarkNotified(1, due, "overdue", due.Add(time.Hour)); e != nil {
		t.Fatal(e)
	}
	code(t, task.MarkNotified(1, due, "overdue", due.Add(time.Hour)), "conflict")
	code(t, task.MarkNotified(2, due.Add(time.Hour), "overdue", due.Add(time.Hour)), "conflict")
	if task.OverdueNotifyCount != 1 {
		t.Fatal(task)
	}
}
func TestListSavePreservesIdentityByNameAndChecksVersion(t *testing.T) {
	d := "2024-02-29"
	l := List{Channel: ListChannel{EditVersion: 8}, Items: []ListItem{{ID: "old", Name: "milk", Until: &d}}}
	n := 0
	id := func() (string, error) { n++; return "new", nil }
	code(t, l.Save(7, nil, id), "conflict")
	if e := l.Save(8, []ListItem{{Name: "milk"}, {Name: "bread"}}, id); e != nil {
		t.Fatal(e)
	}
	if l.Items[0].ID != "old" || l.Items[1].ID != "new" || n != 1 || l.Channel.EditVersion != 9 {
		t.Fatal(l)
	}
	bad := "2023-02-29"
	code(t, ValidateListItems([]ListItem{{Name: "x", Until: &bad}}), "invalid_input")
}
func TestReorderRequiresEveryIDOnce(t *testing.T) {
	for _, ids := range [][]string{{"a"}, {"a", "a"}, {"a", "c"}} {
		code(t, ValidateReorder([]string{"a", "b"}, ids), "invalid_input")
	}
	if e := ValidateReorder([]string{"a", "b"}, []string{"b", "a"}); e != nil {
		t.Fatal(e)
	}
}
func TestInventoryApplyChecksSnapshotAndReferences(t *testing.T) {
	item := InventoryItem{ID: "a", Name: "milk", Stock: quantity(t, "1")}
	c := InventoryCatalog{Items: []InventoryItem{item}}
	code(t, c.Apply(nil, nil, nil), "conflict")
	code(t, c.Apply([]InventoryItem{item}, nil, map[string]bool{"a": true}), "referenced")
	if len(c.Items) != 1 {
		t.Fatal("partial mutation")
	}
	expected := item
	expected.Stock = quantity(t, "1.00")
	if e := c.Apply([]InventoryItem{expected}, []InventoryItem{item}, nil); e != nil {
		t.Fatal(e)
	}
}

func TestListSettingsInvalidateEditorExceptMessageOnly(t *testing.T) {
	l := List{Channel: ListChannel{ChannelSettings: ChannelSettings{ChannelID: "c", ListTitle: "title"}, EditVersion: 8}}
	s := l.Channel
	message := "m"
	s.MessageID = &message
	if e := l.UpdateSettings(s); e != nil {
		t.Fatal(e)
	}
	if l.Channel.EditVersion != 8 {
		t.Fatal("message-only version")
	}
	s = l.Channel
	s.ListTitle = "new title"
	if e := l.UpdateSettings(s); e != nil {
		t.Fatal(e)
	}
	if l.Channel.EditVersion != 9 {
		t.Fatal("title must invalidate editor")
	}
}
func TestListAckIsIdempotentOnSameTokyoDate(t *testing.T) {
	due := "2024-02-01"
	i := ListItem{ID: "i", Until: &due}
	at := instant("2024-01-31T15:00:00Z")
	if !ShouldNotifyList(i, at) {
		t.Fatal("expected due")
	}
	changed, e := i.MarkNotified(due, at)
	if e != nil || !changed {
		t.Fatal(changed, e)
	}
	changed, e = i.MarkNotified(due, at.Add(time.Hour))
	if e != nil || changed {
		t.Fatal(changed, e)
	}
	if ShouldNotifyList(i, at) {
		t.Fatal("already notified")
	}
	_, e = i.MarkNotified("2024-02-02", at)
	code(t, e, "conflict")
}
func TestListSaveIDFailureLeavesAggregateUnchanged(t *testing.T) {
	l := List{Channel: ListChannel{EditVersion: 1}, Items: []ListItem{{ID: "old", Name: "old"}}}
	fail := errors.New("entropy unavailable")
	e := l.Save(1, []ListItem{{Name: "new"}}, func() (string, error) { return "", fail })
	if !errors.Is(e, fail) || l.Channel.EditVersion != 1 || l.Items[0].ID != "old" {
		t.Fatal(l, e)
	}
}
func TestInventoryLinkCannotLoseReferences(t *testing.T) {
	old := "old"
	next := "new"
	c := RemindChannelSettings{LinkedInventoryChannelID: &old}
	code(t, c.ChangeInventoryLink(&next, true), "referenced")
	code(t, c.ChangeInventoryLink(nil, true), "referenced")
	if *c.LinkedInventoryChannelID != "old" {
		t.Fatal(c)
	}
	if e := c.ChangeInventoryLink(&old, true); e != nil {
		t.Fatal(e)
	}
	if e := c.ChangeInventoryLink(nil, false); e != nil || c.LinkedInventoryChannelID != nil {
		t.Fatal(c, e)
	}
}
