//go:build integration

package repository_test

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func outputQueue(t *testing.T, r application.Repository) application.OutputQueue {
	t.Helper()
	q, ok := r.(application.OutputQueue)
	if !ok {
		t.Fatal("transaction repository does not implement OutputQueue")
	}
	return q
}

func queuedOutput(channel string, kind application.OutputKind, now time.Time) application.OutputTask {
	return application.OutputTask{ID: rpID(), ChannelID: channel, TargetID: channel, DestinationKey: channel + ":card", Kind: kind, State: application.OutputPending, CreatedAt: now, UpdatedAt: now, AvailableAt: now}
}

func TestOutputBusinessRecordAndQueueRollbackTogether(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Microsecond)
	abort := errors.New("abort transaction")
	for _, failure := range []bool{true, false} {
		task := queuedOutput("100", application.OutputListRender, now)
		op := application.OperationRecord{ID: rpID(), ChannelID: "100", ActorID: "actor", Kind: "AddListModalHandler", Success: true, OccurredAt: now}
		task.OperationID = op.ID
		err := store.Write(ctx, func(r application.Repository) error {
			q := outputQueue(t, r)
			if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "saved"}, DefaultCategory: "その他"}}); err != nil {
				return err
			}
			if _, err := q.PutOperation(ctx, op); err != nil {
				return err
			}
			if _, err := q.EnqueueOutput(ctx, task); err != nil {
				return err
			}
			if failure {
				return abort
			}
			return nil
		})
		if failure && !errors.Is(err, abort) || !failure && err != nil {
			t.Fatal(err)
		}
		rpRead(t, store, func(r application.Repository) error {
			q := outputQueue(t, r)
			list, err := r.GetList(ctx, "100", false)
			if err != nil {
				return err
			}
			record, err := q.GetOperation(ctx, op.ID)
			if err != nil {
				return err
			}
			job, err := q.GetOutput(ctx, task.ID, false)
			if err != nil {
				return err
			}
			if failure && (list != nil || record != nil || job != nil) {
				t.Fatal("write escaped rollback")
			}
			if !failure && (list == nil || record == nil || job == nil) {
				t.Fatal("committed unit incomplete")
			}
			return nil
		})
	}
}

func TestOutputConcurrentCardsCoalesceButRunningKeepsSuccessorAndLogsStaySeparate(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC()
	var wg sync.WaitGroup
	errs := make(chan error, 16)
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- store.Write(ctx, func(r application.Repository) error {
				_, err := outputQueue(t, r).EnqueueOutput(ctx, queuedOutput("100", application.OutputListRender, now))
				return err
			})
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var running application.OutputTask
	rpWrite(t, store, func(r application.Repository) error {
		q := outputQueue(t, r)
		jobs, err := q.ListOutputs(ctx, application.OutputFilter{ChannelID: "100", Limit: 100})
		if err != nil {
			return err
		}
		if len(jobs) != 1 {
			t.Fatalf("concurrent cards: %d", len(jobs))
		}
		running = jobs[0]
		running.State = application.OutputRunning
		running.Executor = "leader"
		return q.PutOutput(ctx, running)
	})
	rpWrite(t, store, func(r application.Repository) error {
		q := outputQueue(t, r)
		for range 2 {
			if _, err := q.EnqueueOutput(ctx, queuedOutput("100", application.OutputListRender, now)); err != nil {
				return err
			}
			if _, err := q.EnqueueOutput(ctx, queuedOutput("100", application.OutputOperationLog, now)); err != nil {
				return err
			}
		}
		jobs, err := q.ListOutputs(ctx, application.OutputFilter{ChannelID: "100", Limit: 100})
		if err != nil {
			return err
		}
		if len(jobs) != 4 || jobs[0].ID != running.ID {
			t.Fatalf("running/successor/log ordering: %#v", jobs)
		}
		return nil
	})
}

func TestOutputDispatchSuspensionAndViewPersistIndependentlyOfBusinessRows(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Microsecond)
	task := queuedOutput("100", application.OutputThreadEnsure, now)
	dispatch := application.OutputDispatch{ID: rpID(), TaskID: task.ID, Attempt: 1, Nonce: "fixed", StartedAt: now, Outcome: application.DispatchUnknown}
	rpWrite(t, store, func(r application.Repository) error {
		q := outputQueue(t, r)
		if _, err := q.EnqueueOutput(ctx, task); err != nil {
			return err
		}
		if err := q.PutDispatch(ctx, dispatch); err != nil {
			return err
		}
		if err := q.PutSuspension(ctx, application.OutputSuspension{ChannelID: "100", SuspendedBy: "actor", SuspendedAt: now}); err != nil {
			return err
		}
		view := application.CardView{ChannelID: "100", TargetKind: application.CardInventory, TargetID: "100", Mode: application.CardDeleteSelection, Page: 1}
		first, err := q.PutCardView(ctx, view)
		if err != nil {
			return err
		}
		second, err := q.PutCardView(ctx, view)
		if err != nil {
			return err
		}
		if second.Version <= first.Version {
			t.Fatal("view version did not increase")
		}
		return nil
	})
	rpRead(t, store, func(r application.Repository) error {
		q := outputQueue(t, r)
		dispatches, err := q.OutputDispatches(ctx, task.ID)
		if err != nil {
			return err
		}
		rpEqual(t, []application.OutputDispatch{dispatch}, dispatches)
		suspension, err := q.GetSuspension(ctx, "100")
		if err != nil {
			return err
		}
		if suspension == nil || suspension.SuspendedBy != "actor" {
			t.Fatal("suspension lost")
		}
		view, err := q.GetCardView(ctx, "100", application.CardInventory, "100")
		if err != nil {
			return err
		}
		if view == nil || view.Mode != application.CardDeleteSelection || view.Page != 1 {
			t.Fatal("view lost")
		}
		return nil
	})
}

func TestOutputUIDedupAndDailyOverdueReservations(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC()
	rpWrite(t, store, func(r application.Repository) error {
		q := outputQueue(t, r)
		op := application.OperationRecord{ID: rpID(), ChannelID: "100", ActorID: "actor", Kind: "AddListModalHandler", InteractionID: "one-interaction", OccurredAt: now}
		inserted, err := q.PutOperation(ctx, op)
		if err != nil {
			return err
		}
		if !inserted {
			t.Fatal("first UI event ignored")
		}
		op.ID = rpID()
		inserted, err = q.PutOperation(ctx, op)
		if err != nil {
			return err
		}
		if inserted {
			t.Fatal("duplicate UI event accepted")
		}
		var first string
		for _, day := range []string{"2026-09-07", "2026-09-07", "2026-09-08"} {
			task := queuedOutput("100", application.OutputReminderNotice, now)
			task.Payload.Notification = &application.OutputNotification{Kind: "overdue", TargetDueAt: "2026-09-06T00:00:00Z", NotificationDay: day, ExpectedRevision: "1"}
			id, err := q.EnqueueOutput(ctx, task)
			if err != nil {
				return err
			}
			if first == "" {
				first = id
			} else if day == "2026-09-07" && first != id {
				t.Fatal("duplicate tick created another notice")
			}
		}
		jobs, err := q.ListOutputs(ctx, application.OutputFilter{ChannelID: "100"})
		if err != nil {
			return err
		}
		if len(jobs) != 2 {
			t.Fatalf("daily overdue notices: %d", len(jobs))
		}
		return nil
	})
}
