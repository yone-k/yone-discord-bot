//go:build integration

package repository_test

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

func TestOutputStatusKeepsDeleteCreationDependencyReason(t *testing.T) {
	_, store := rpSetup(t)
	now := time.Now().UTC()
	prior := queuedOutput("100", application.OutputOperationLog, now)
	deletion := queuedOutput("100", application.OutputDeleteAll, now)
	deletion.Payload.DependencyTaskID = prior.ID
	deletion.LastError = "先行投稿の結果確認待ち"
	rpWrite(t, store, func(r application.Repository) error {
		if _, err := r.EnqueueOutput(t.Context(), prior); err != nil {
			return err
		}
		_, err := r.EnqueueOutput(t.Context(), deletion)
		return err
	})
	status, err := application.New(store, fixedClock{now}, ids{}).GetOutputStatus(t.Context(), true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Holds) != 1 || status.Holds[0].TaskID != deletion.ID || status.Holds[0].Reason != "先行投稿の結果確認待ち" {
		t.Fatal("delete dependency was described as notification setup", status.Holds)
	}
}

func TestOutputStatusOldestTimeIncludesUnresolvedCancelledCreation(t *testing.T) {
	_, store := rpSetup(t)
	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	var cancelled application.OutputTask
	for i, state := range []application.OutputState{application.OutputSucceeded, application.OutputCancelled, application.OutputUncertain, application.OutputPending} {
		job := queuedOutput("100", application.OutputOperationLog, now.Add(time.Duration(i-4)*time.Hour))
		job.State = state
		job.Payload.HoldCreation = state == application.OutputCancelled
		rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, job); return err })
		if state == application.OutputCancelled {
			cancelled = job
		}
	}
	status, err := s.GetOutputStatus(ctx, true, false)
	if err != nil || status.OldestPendingAt == nil || !status.OldestPendingAt.Equal(now.Add(-3*time.Hour)) {
		t.Fatal("oldest unresolved creation omitted", status, err)
	}
	rpWrite(t, store, func(r application.Repository) error {
		job, err := r.GetOutput(ctx, cancelled.ID, true)
		if err != nil {
			return err
		}
		job.Payload.HoldCreation = false
		return r.PutOutput(ctx, *job)
	})
	status, err = s.GetOutputStatus(ctx, true, false)
	if err != nil || status.OldestPendingAt == nil || !status.OldestPendingAt.Equal(now.Add(-2*time.Hour)) {
		t.Fatal("uncertain output omitted", status, err)
	}
}

func TestOutputStatusShowsNotificationDependencyAndUnconfiguredStop(t *testing.T) {
	_, store := rpSetup(t)
	_, ch, task := rpSeedCatalogTask(t, store)
	ctx, now := t.Context(), time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
	ch.RemindNoticeMessageID, ch.RemindNoticeThreadID = nil, nil
	task.IsPaused, task.OverdueNotifyCount, task.LastOverdueNotifiedAt = false, 0, nil
	task.NextDueAt = now.Add(-time.Hour)
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutRemindChannel(ctx, ch); err != nil {
			return err
		}
		if err := r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false); err != nil {
			return err
		}
		return r.PutSuspension(ctx, application.OutputSuspension{ChannelID: "777", SuspendedBy: "999", SuspendedAt: now})
	})
	s := application.New(store, fixedClock{now}, ids{})
	if err := s.ReserveNotifications(ctx); err != nil {
		t.Fatal(err)
	}
	status, err := s.GetOutputStatus(ctx, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if status.Contract != application.OutputContract || !status.Enabled || status.WorkerRunning || status.OldestPendingAt == nil || !status.OldestPendingAt.Equal(now) {
		t.Fatal("incorrect worker/queue status", status)
	}
	if len(status.Suspensions) != 1 || status.Suspensions[0].ChannelID != "777" {
		t.Fatal("stop without channel settings omitted", status.Suspensions)
	}
	if len(status.Holds) != 2 {
		t.Fatal("notification dependency hold omitted", status.Holds)
	}
	var dependency string
	for _, hold := range status.Holds {
		if hold.Kind == application.OutputThreadEnsure {
			dependency = hold.TaskID
		}
	}
	for _, hold := range status.Holds {
		if hold.Kind == application.OutputReminderNotice && (hold.DependencyTaskID != dependency || hold.Reason != "既存通知先の所在不明") {
			t.Fatal("dependency reason lost", hold)
		}
	}
	if next, err := s.ClaimOutput(ctx, "leader"); err != nil || next != nil {
		t.Fatal("claimed notification before dependency resolution", next, err)
	}
	// Confirming the dependency releases the notification without a new job.
	rpWrite(t, store, func(r application.Repository) error {
		job, err := r.GetOutput(ctx, dependency, true)
		if err != nil {
			return err
		}
		job.State = application.OutputSucceeded
		return r.PutOutput(ctx, *job)
	})
	if next, err := s.ClaimOutput(ctx, "leader"); err != nil || next == nil || next.Kind != application.OutputReminderNotice {
		t.Fatal("dependency resolution did not release notification", next, err)
	}
}
