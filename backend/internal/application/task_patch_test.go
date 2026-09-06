package application

import (
	"context"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestTaskPatchIsEmptyIncludesEveryField(t *testing.T) {
	if !(TaskPatch{}).IsEmpty() {
		t.Fatal("a patch without fields must be empty")
	}
	for name, patch := range map[string]TaskPatch{
		"messageId":           {MessageID: Some[*string](nil)},
		"title":               {Title: Some("")},
		"description":         {Description: Some[*string](nil)},
		"intervalDays":        {IntervalDays: Some(0)},
		"timeOfDay":           {TimeOfDay: Some("")},
		"remindBeforeMinutes": {RemindBeforeMinutes: Some(0)},
		"overdueNotifyLimit":  {OverdueNotifyLimit: Some[*int](nil)},
		"lastDoneAt":          {LastDoneAt: Some[*time.Time](nil)},
		"nextDueAt":           {NextDueAt: Some(time.Time{})},
	} {
		t.Run(name, func(t *testing.T) {
			if patch.IsEmpty() {
				t.Fatal("an explicitly present field must make the patch nonempty, including null and zero values")
			}
		})
	}
}

type taskPatchRepository struct {
	// Unused ports fail immediately if PatchTask accesses an unrelated aggregate.
	Repository
	task domain.RemindTask
}

func (r *taskPatchRepository) GetRemindChannel(context.Context, string, bool) (*domain.RemindChannelSettings, error) {
	return &domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: r.task.ChannelID}}, nil
}

func (r *taskPatchRepository) GetTask(context.Context, string, string, bool) (*domain.RemindTask, error) {
	copy := r.task
	return &copy, nil
}

func (r *taskPatchRepository) PutTask(_ context.Context, task *domain.RemindTask, _ *string, _ bool) error {
	r.task = *task
	return nil
}

func TestPatchTaskNormalizesLastDoneAtBeforeReturningAndPersisting(t *testing.T) {
	now := time.Date(2026, 9, 6, 0, 0, 0, 0, time.UTC)
	input := time.Date(2026, 9, 5, 21, 15, 30, 123456789, time.FixedZone("JST", 9*60*60))
	original := input
	repo := &taskPatchRepository{task: domain.RemindTask{
		ID: "legacy", ChannelID: "3", Title: "task", IntervalDays: 1, TimeOfDay: "21:00",
		StartAt: now.Add(-48 * time.Hour), NextDueAt: now.Add(24 * time.Hour), CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now,
	}}
	service := New(readStore{repo}, &countingClock{time: now}, nil)
	updated, err := service.PatchTask(context.Background(), "3", "legacy", 0, TaskPatch{LastDoneAt: Some(&input)})
	if err != nil {
		t.Fatal(err)
	}
	want := input.UTC().Truncate(time.Millisecond)
	for name, value := range map[string]*time.Time{"response": updated.LastDoneAt, "persisted": repo.task.LastDoneAt} {
		if value == nil || value.Location() != time.UTC || !value.Equal(want) {
			t.Errorf("%s must use UTC milliseconds, got %v, want %v", name, value, want)
		}
	}
	if input != original {
		t.Fatal("patch mutated the caller's timestamp")
	}
}
