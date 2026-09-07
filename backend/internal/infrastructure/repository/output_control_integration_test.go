//go:build integration

package repository_test

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

func TestOutputRetryRequiresConfirmationAndPreservesNonce(t *testing.T) {
	db, store := rpSetup(t)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	job := queuedOutput("100", application.OutputOperationLog, now)
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, job); return err })
	if _, err := s.ClaimOutput(ctx, "worker"); err != nil {
		t.Fatal(err)
	}
	dispatch, err := s.BeginOutputDispatch(ctx, job.ID, "worker", "message", "200", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RetryOutputConfirmedUnsent(ctx, job.ID, true); err == nil {
		t.Fatal("running task changed")
	}
	if err := s.FailOutput(ctx, job.ID, "worker", dispatch.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
		t.Fatal(err)
	}
	if err := s.RetryOutputConfirmedUnsent(ctx, job.ID, false); err == nil {
		t.Fatal("unconfirmed retry accepted")
	}
	if err := s.RetryOutputConfirmedUnsent(ctx, job.ID, true); err != nil {
		t.Fatal(err)
	}
	detail, err := s.GetOutputDetails(ctx, job.ID)
	if err != nil || detail.Task.State != application.OutputRetryWait || detail.Dispatches[0].Outcome != application.DispatchFailed {
		t.Fatal(detail, err)
	}
	if _, err := s.ClaimOutput(ctx, "worker2"); err != nil {
		t.Fatal(err)
	}
	second, err := s.BeginOutputDispatch(ctx, job.ID, "worker2", "message", "200", false)
	if err != nil || second.Nonce != dispatch.Nonce || second.Attempt != 2 {
		t.Fatal(second, err)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records WHERE operation_kind='outputctl' AND actor_id='999'").Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
}

func TestCancelledUnknownCreationStillBlocksNewCreation(t *testing.T) {
	_, store := rpSetup(t)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	job := queuedOutput("100", application.OutputOperationLog, now)
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, job); return err })
	if _, err := s.ClaimOutput(ctx, "worker"); err != nil {
		t.Fatal(err)
	}
	dispatch, err := s.BeginOutputDispatch(ctx, job.ID, "worker", "message", "200", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelOutput(ctx, job.ID); err == nil {
		t.Fatal("cancelled a running job")
	}
	if err := s.FailOutput(ctx, job.ID, "worker", dispatch.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelOutput(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	detail, err := s.GetOutputDetails(ctx, job.ID)
	if err != nil || detail.Task.State != application.OutputCancelled || detail.Dispatches[0].Outcome != application.DispatchUnknown {
		t.Fatal(detail, err)
	}
	status, err := s.GetOutputStatus(ctx, true, false)
	if err != nil || len(status.Holds) != 1 || status.Holds[0].TaskID != job.ID || status.Holds[0].State != application.OutputCancelled {
		t.Fatal("cancelled unknown creation disappeared from operational status", status, err)
	}
	next := queuedOutput("100", application.OutputOperationLog, now)
	next.DestinationKey = job.DestinationKey
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, next); return err })
	if _, err := s.ClaimOutput(ctx, "worker2"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.BeginOutputDispatch(ctx, next.ID, "worker2", "message", "200", false); err == nil {
		t.Fatal("cancel bypassed unknown creation barrier")
	}
}

func TestOutputControlRejectsMissingOrWrongOperatorWithoutChangingJob(t *testing.T) {
	db, store := rpSetup(t)
	now := time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	job := queuedOutput("100", application.OutputOperationLog, now)
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(t.Context(), job); return err })
	wrong, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "InitListCommand"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelOutput(t.Context(), job.ID); err == nil {
		t.Fatal("missing operator accepted")
	}
	if err := s.CancelOutput(wrong, job.ID); err == nil {
		t.Fatal("business operation used as control operator")
	}
	detail, err := s.GetOutputDetails(t.Context(), job.ID)
	if err != nil || detail.Task.State != application.OutputPending {
		t.Fatal(detail, err)
	}
	var count int
	if err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
}

func TestOutputCancellationKeepsDeletionSuspendedAndIsAtomicWithAudit(t *testing.T) {
	for _, rejectAudit := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "audit failure"}[rejectAudit], func(t *testing.T) {
			db, store := rpSetup(t)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			s := application.New(store, fixedClock{now}, ids{})
			job := queuedOutput("100", application.OutputDeleteAll, now)
			job.Payload.Deletion = &application.DeleteProgress{UpperID: "200"}
			rpWrite(t, store, func(r application.Repository) error {
				if _, err := r.EnqueueOutput(ctx, job); err != nil {
					return err
				}
				return r.PutSuspension(ctx, application.OutputSuspension{ChannelID: "100", SuspendedBy: "999", SuspendedAt: now})
			})
			if rejectAudit {
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_control_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER reject_control_audit BEFORE INSERT ON operation_records FOR EACH ROW EXECUTE FUNCTION reject_control_audit()`); err != nil {
					t.Fatal(err)
				}
			}
			err = s.CancelOutput(ctx, job.ID)
			if (err != nil) != rejectAudit {
				t.Fatal(err)
			}
			detail, err := s.GetOutputDetails(ctx, job.ID)
			if err != nil {
				t.Fatal(err)
			}
			want := application.OutputCancelled
			if rejectAudit {
				want = application.OutputPending
			}
			if detail.Task.State != want || detail.Task.Payload.Deletion.FirstAttemptFinished != !rejectAudit {
				t.Fatal(detail.Task)
			}
			var count int
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM channel_output_suspensions WHERE channel_id='100'").Scan(&count); err != nil || count != 1 {
				t.Fatal("cancellation resumed the channel", count, err)
			}
		})
	}
}
