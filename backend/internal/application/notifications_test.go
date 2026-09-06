package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type countingClock struct {
	calls int
	time  time.Time
}

func (c *countingClock) Now() time.Time {
	c.calls++
	return c.time.Add(time.Duration(c.calls-1) * time.Minute)
}

type readStore struct{ repo Repository }

func (s readStore) Read(_ context.Context, fn func(Repository) error) error  { return fn(s.repo) }
func (s readStore) Write(_ context.Context, fn func(Repository) error) error { return fn(s.repo) }

type notificationRepository struct {
	// Unused ports deliberately panic if the operation unexpectedly accesses them.
	Repository
	task  domain.RemindTask
	lists []domain.ListChannel
}

func (r notificationRepository) Lists(context.Context) ([]domain.ListChannel, error) {
	return r.lists, nil
}

func TestAckRejectsInvalidTokensBeforeAccessingRecords(t *testing.T) {
	now := time.Date(2026, 9, 6, 0, 0, 0, 0, time.UTC)
	revision := int64(1)
	for name, input := range map[string]NotificationToken{
		"list revision":      {Kind: "list", ExpectedRevision: &revision, EvaluatedAt: now},
		"unknown kind":       {Kind: "unknown", EvaluatedAt: now},
		"missing revision":   {Kind: "before", EvaluatedAt: now},
		"invalid deadline":   {Kind: "overdue", ExpectedRevision: &revision, TargetDueAt: "invalid", EvaluatedAt: now},
		"missing evaluation": {Kind: "before", ExpectedRevision: &revision},
	} {
		t.Run(name, func(t *testing.T) {
			s := New(readStore{notificationRepository{}}, &countingClock{time: now}, nil)
			_, err := s.AckNotification(context.Background(), input)
			var failure *domain.Error
			if !errors.As(err, &failure) || failure.Code != "invalid_input" {
				t.Fatalf("invalid token was not rejected: %v", err)
			}
		})
	}
}

func TestProgressOnlyAtTheHourAndListsWithoutThreadAreSkipped(t *testing.T) {
	message := "55"
	for _, minute := range []int{0, 1} {
		now := time.Date(2026, 9, 6, 0, minute, 0, 0, time.UTC)
		repo := notificationRepository{
			lists: []domain.ListChannel{{ChannelSettings: domain.ChannelSettings{ChannelID: "1"}}},
			task:  domain.RemindTask{ID: "task", MessageID: &message, NextDueAt: now.Add(24 * time.Hour)},
		}
		s := New(readStore{repo}, &countingClock{time: now}, nil)
		plan, err := s.PollNotifications(context.Background())
		if err != nil || len(plan.Notifications) != 0 || len(plan.Progress) != 1-minute {
			t.Fatalf("unexpected plan at minute %d: %#v, %v", minute, plan, err)
		}
	}
}

func TestDuplicateInventoryEditNamesHaveStableReason(t *testing.T) {
	s := New(readStore{notificationRepository{}}, nil, nil)
	_, err := s.EditTaskInventory(context.Background(), "3", "task", 1, []RemindInventoryEdit{{Name: "rice"}, {Name: "rice"}})
	var failure *domain.Error
	if !errors.As(err, &failure) || failure.Reason != domain.ReasonDuplicateName {
		t.Fatalf("missing duplicate-name reason: %v", err)
	}
}
func (notificationRepository) RemindChannels(context.Context) ([]domain.RemindChannelSettings, error) {
	return []domain.RemindChannelSettings{{ChannelSettings: domain.ChannelSettings{ChannelID: "3"}}}, nil
}
func (r notificationRepository) Tasks(context.Context, string, bool) ([]domain.RemindTask, error) {
	return []domain.RemindTask{r.task}, nil
}
func TestNotificationPlanUsesOneClockEvaluationForAllDecisions(t *testing.T) {
	now := time.Date(2026, 9, 5, 12, 59, 0, 0, time.UTC)
	clock := &countingClock{time: now}
	message := "55"
	repo := notificationRepository{task: domain.RemindTask{ID: "legacy", ChannelID: "3", MessageID: &message, NextDueAt: now, RemindBeforeMinutes: 0}}
	s := New(readStore{repo}, clock, nil)
	plan, err := s.PollNotifications(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if clock.calls != 1 || len(plan.Notifications) != 1 || plan.Notifications[0].Kind != "before" || !plan.Notifications[0].EvaluatedAt.Equal(now) {
		t.Fatalf("inconsistent clock evaluation: %d %#v", clock.calls, plan)
	}
}

func TestCompletionNameParsingRejectsUnknownDuplicateAndMissingVariableQuantity(t *testing.T) {
	q, _ := domain.ParseQuantity("1")
	task := domain.RemindTask{InventoryItems: []domain.InventoryConsumption{{InventoryID: "legacy", Consume: domain.Quantity{}}}}
	catalog := &domain.InventoryCatalog{Items: []domain.InventoryItem{{ID: "legacy", Name: " milk "}}}
	for _, entries := range [][]ConsumptionOverride{{{Name: "missing", Consume: &q}}, {{Name: " milk "}, {Name: " milk "}}} {
		if _, err := completionOverrides(task, catalog, entries); err == nil {
			t.Fatal("invalid name inputs accepted")
		}
	}
	refs, err := completionOverrides(task, catalog, []ConsumptionOverride{{Name: " milk "}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = task.ResolveConsumption(refs); err == nil {
		t.Fatal("variable quantity omission accepted")
	}
	refs, err = completionOverrides(task, catalog, []ConsumptionOverride{{Name: " milk ", Consume: &q}})
	if err != nil || len(refs) != 1 || refs[0].InventoryID != "legacy" {
		t.Fatal("exact inventory name did not resolve")
	}
}
