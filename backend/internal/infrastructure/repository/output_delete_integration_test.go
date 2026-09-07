//go:build integration

package repository_test

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

func TestDeleteAllAcceptanceStopsOutputAtomically(t *testing.T) {
	for _, failReservation := range []bool{false, true} {
		t.Run(map[bool]string{false: "accepted", true: "rollback"}[failReservation], func(t *testing.T) {
			db, store := rpSetup(t)
			now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "DeleteAllMessageCommand", InteractionID: "888"})
			if err != nil {
				t.Fatal(err)
			}
			if failReservation {
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_delete_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected output failure'; END $$; CREATE TRIGGER reject_delete_job BEFORE INSERT ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_delete_job()`); err != nil {
					t.Fatal(err)
				}
			}
			s := application.New(store, fixedClock{now}, ids{})
			job, err := s.RequestDeleteAll(ctx, "100")
			if (err != nil) != failReservation {
				t.Fatal("incorrect acceptance result", err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stop, err := r.GetSuspension(ctx, "100")
				if err != nil {
					return err
				}
				if failReservation {
					if stop != nil {
						t.Fatal("failed reservation left output suspended")
					}
					return nil
				}
				if stop == nil || stop.SuspendedBy != "999" || !stop.SuspendedAt.Equal(now) {
					t.Fatal("missing atomic suspension", stop)
				}
				if job.Payload.Deletion == nil || job.Payload.Deletion.UpperID == "" || job.Payload.Deletion.BeforeID == "" {
					t.Fatal("missing fixed pagination boundary", job)
				}
				return nil
			})
			if failReservation {
				return
			}
			// Retried acceptance returns the active job and its original boundary.
			s = application.New(store, fixedClock{now.Add(time.Minute)}, ids{})
			again, err := s.RequestDeleteAll(ctx, "100")
			if err != nil || again.ID != job.ID || again.Payload.Deletion.UpperID != job.Payload.Deletion.UpperID {
				t.Fatal("acceptance changed deletion boundary", again, err)
			}
			if claimed, err := s.ClaimOutput(ctx, "leader"); err != nil || claimed == nil || claimed.ID != job.ID {
				t.Fatal("suspension blocked its delete job", claimed, err)
			}
		})
	}
}

func TestDeleteAllWaitsForUnknownPriorCreation(t *testing.T) {
	_, store := rpSetup(t)
	now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "DeleteAllMessageCommand"})
	if err != nil {
		t.Fatal(err)
	}
	prior := queuedOutput("100", application.OutputOperationLog, now)
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, prior); return err })
	s := application.New(store, fixedClock{now}, ids{})
	if job, err := s.ClaimOutput(ctx, "leader"); err != nil || job == nil {
		t.Fatal(job, err)
	}
	dispatch, err := s.BeginOutputDispatch(ctx, prior.ID, "leader", "message", "200", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FailOutput(ctx, prior.ID, "leader", dispatch.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
		t.Fatal(err)
	}
	deletion, err := s.RequestDeleteAll(ctx, "100")
	if err != nil {
		t.Fatal(err)
	}
	if job, err := s.ClaimOutput(ctx, "leader"); err != nil || job != nil {
		t.Fatal("delete started with unresolved creation", job, err)
	}
	rpRead(t, store, func(r application.Repository) error {
		stored, err := r.GetOutput(ctx, deletion.ID, false)
		if err != nil {
			return err
		}
		if !stored.Payload.Deletion.FirstAttemptFinished || stored.Payload.DependencyTaskID != prior.ID {
			t.Fatal("unknown predecessor not exposed", stored)
		}
		return nil
	})
	// Explicitly confirmed-unsent evidence permits deletion, even if the
	// predecessor itself was cancelled rather than successfully posted.
	rpWrite(t, store, func(r application.Repository) error {
		dispatch.Outcome = application.DispatchFailed
		if err := r.PutDispatch(ctx, *dispatch); err != nil {
			return err
		}
		stored, err := r.GetOutput(ctx, prior.ID, true)
		if err != nil {
			return err
		}
		stored.State = application.OutputCancelled
		return r.PutOutput(ctx, *stored)
	})
	s = application.New(store, fixedClock{now.Add(time.Second)}, ids{})
	if job, err := s.ClaimOutput(ctx, "leader"); err != nil || job == nil || job.ID != deletion.ID || job.Payload.DependencyTaskID != "" {
		t.Fatal("resolved predecessor still blocks deletion", job, err)
	}
}
