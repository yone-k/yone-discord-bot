//go:build integration

package repository_test

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestQueueSchedulingAndStatusDoNotDecodeCompletedHistory(t *testing.T) {
	for _, action := range []string{"claim", "recover", "status", "dispatch"} {
		t.Run(action, func(t *testing.T) {
			db, store := rpSetup(t)
			ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
			s := application.New(store, fixedClock{now}, ids{})
			history := queuedOutput("100", application.OutputOperationLog, now)
			history.State = application.OutputSucceeded
			next := queuedOutput("200", application.OutputOperationLog, now)
			if action == "dispatch" {
				history.State = application.OutputCancelled
				next = queuedOutput("100", application.OutputOperationLog, now)
			}
			rpWrite(t, store, func(r application.Repository) error {
				if _, err := r.EnqueueOutput(ctx, history); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, next)
				return err
			})
			// Poison only a historical payload: scheduling/counting must not read
			// or decode it, regardless of how many completed rows accumulate.
			if _, err := db.ExecContext(ctx, `UPDATE output_tasks SET payload='{"Stages":"historical-format"}' WHERE id=$1`, history.ID); err != nil {
				t.Fatal(err)
			}
			switch action {
			case "dispatch":
				job, err := s.ClaimOutput(ctx, "worker")
				if err != nil || job == nil {
					t.Fatal(job, err)
				}
				if _, err := s.BeginOutputDispatch(ctx, job.ID, "worker", "message", "300", false); err != nil {
					t.Fatal("completed cancellation history must not be decoded", err)
				}
			case "claim":
				job, err := s.ClaimOutput(ctx, "worker")
				if err != nil || job == nil || job.ID != next.ID {
					t.Fatal(job, err)
				}
			case "recover":
				if err := s.RecoverRunningOutputs(ctx); err != nil {
					t.Fatal(err)
				}
			case "status":
				status, err := s.GetOutputStatus(ctx, true, false)
				if err != nil {
					t.Fatal(err)
				}
				counts := map[application.OutputState]int{}
				for _, count := range status.Counts {
					counts[count.State] = count.Count
				}
				if counts[application.OutputSucceeded] != 1 || counts[application.OutputPending] != 1 {
					t.Fatal(status)
				}
			}
		})
	}
}

func TestClaimCandidatePaginationSkipsSuspensionAndMissingDependency(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	ready := queuedOutput("300", application.OutputOperationLog, now)
	rpWrite(t, store, func(r application.Repository) error {
		if _, err := r.EnqueueOutput(ctx, queuedOutput("100", application.OutputOperationLog, now)); err != nil {
			return err
		}
		if err := r.PutSuspension(ctx, application.OutputSuspension{ChannelID: "100", SuspendedAt: now, SuspendedBy: "999"}); err != nil {
			return err
		}
		waiting := queuedOutput("200", application.OutputOperationLog, now)
		waiting.Payload.DependencyTaskID = rpID()
		if _, err := r.EnqueueOutput(ctx, waiting); err != nil {
			return err
		}
		_, err := r.EnqueueOutput(ctx, ready)
		return err
	})
	s := application.New(store, fixedClock{now}, ids{})
	claimed, err := s.ClaimOutput(ctx, "worker")
	if err != nil || claimed == nil || claimed.ID != ready.ID {
		t.Fatal(claimed, err)
	}
}

func TestOutputClaimSerializesChannelsAndHonorsSuspensions(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	rpWrite(t, store, func(r application.Repository) error {
		for _, channel := range []string{"100", "100", "200", "300"} {
			if _, err := r.EnqueueOutput(ctx, queuedOutput(channel, application.OutputOperationLog, now)); err != nil {
				return err
			}
		}
		return r.PutSuspension(ctx, application.OutputSuspension{ChannelID: "300", SuspendedAt: now, SuspendedBy: "actor"})
	})
	first, err := s.ClaimOutput(ctx, "leader")
	if err != nil || first == nil || first.ChannelID != "100" {
		t.Fatal(first, err)
	}
	second, err := s.ClaimOutput(ctx, "leader")
	if err != nil || second == nil || second.ChannelID != "200" {
		t.Fatal(second, err)
	}
	third, err := s.ClaimOutput(ctx, "leader")
	if err != nil || third != nil {
		t.Fatal("running channel or suspended channel claimed", third, err)
	}
}

func TestOutputCreatedIDAndDispatchCommitAtomically(t *testing.T) {
	for _, failSave := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "database-save-failure"}[failSave], func(t *testing.T) {
			db, store := rpSetup(t)
			ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
			s := application.New(store, fixedClock{now}, ids{})
			task := queuedOutput("100", application.OutputListRender, now)
			rpWrite(t, store, func(r application.Repository) error {
				if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list"}, DefaultCategory: "その他"}}); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, task)
				return err
			})
			if job, err := s.ClaimOutput(ctx, "leader"); err != nil || job == nil {
				t.Fatal(job, err)
			}
			dispatch, err := s.BeginOutputDispatch(ctx, task.ID, "leader", "message", "100", false)
			if err != nil {
				t.Fatal(err)
			}
			if failSave {
				_, err := db.ExecContext(ctx, `CREATE FUNCTION reject_output_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.outcome='succeeded' THEN RAISE EXCEPTION 'injected result save failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_output_result BEFORE UPDATE ON output_dispatches FOR EACH ROW EXECUTE FUNCTION reject_output_result()`)
				if err != nil {
					t.Fatal(err)
				}
			}
			err = s.CompleteOutputDispatch(ctx, task.ID, "leader", "message", dispatch.ID, "200", true)
			if failSave && err == nil || !failSave && err != nil {
				t.Fatal("wrong save result", err)
			}
			rpRead(t, store, func(r application.Repository) error {
				list, err := r.GetList(ctx, "100", false)
				if err != nil {
					return err
				}
				history, err := r.OutputDispatches(ctx, task.ID)
				if err != nil {
					return err
				}
				job, err := r.GetOutput(ctx, task.ID, false)
				if err != nil {
					return err
				}
				if failSave {
					if list.Channel.MessageID != nil || history[0].Outcome != application.DispatchUnknown || job.State != application.OutputRunning {
						t.Fatal("partial result committed")
					}
				} else if list.Channel.MessageID == nil || *list.Channel.MessageID != "200" || history[0].DiscordMessageID != "200" || job.State != application.OutputSucceeded {
					t.Fatal("created ID not committed with result")
				}
				return nil
			})
			if failSave {
				if err := s.RecoverRunningOutputs(ctx); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestOutputDispatchCommitsBeforeSendAndRecoveryNeverReplaysUnknownCreate(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	task := queuedOutput("100", application.OutputTaskCard, now)
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, task); return err })
	claimed, err := s.ClaimOutput(ctx, "leader")
	if err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	dispatch, err := s.BeginOutputDispatch(ctx, claimed.ID, "leader", "message", "100", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(dispatch.Nonce) != 22 {
		t.Fatal("nonce does not encode UUID", dispatch.Nonce)
	}
	rpRead(t, store, func(r application.Repository) error {
		rows, err := r.OutputDispatches(ctx, task.ID)
		if err != nil {
			return err
		}
		if len(rows) != 1 || rows[0].Outcome != application.DispatchUnknown {
			t.Fatal("send intent not committed", rows)
		}
		return nil
	})
	// A successor and a different output destination exist when the process dies.
	rpWrite(t, store, func(r application.Repository) error {
		if _, err := r.EnqueueOutput(ctx, queuedOutput("100", application.OutputTaskCard, now)); err != nil {
			return err
		}
		other := queuedOutput("100", application.OutputOperationLog, now)
		other.DestinationKey = "100:log"
		_, err := r.EnqueueOutput(ctx, other)
		return err
	})
	if err := s.RecoverRunningOutputs(ctx); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		job, err := r.GetOutput(ctx, task.ID, false)
		if err != nil {
			return err
		}
		if job.State != application.OutputUncertain {
			t.Fatal("unknown creation became retryable", job.State)
		}
		return nil
	})
	next, err := s.ClaimOutput(ctx, "new-leader")
	if err != nil || next == nil || next.Kind != application.OutputOperationLog {
		t.Fatal("barrier bypassed or unrelated output blocked", next, err)
	}
}

func TestOutputRecoveryMergesKnownWorkWithPendingSuccessor(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	task := queuedOutput("100", application.OutputTaskCard, now)
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, task); return err })
	if _, err := s.ClaimOutput(ctx, "leader"); err != nil {
		t.Fatal(err)
	}
	successor := queuedOutput("100", application.OutputTaskCard, now)
	successor.Payload.MessageID = "300"
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, successor); return err })
	rpWrite(t, store, func(r application.Repository) error {
		redraw := queuedOutput("100", application.OutputTaskCard, now)
		redraw.Payload.PinMessage = true
		_, err := r.EnqueueOutput(ctx, redraw)
		return err
	})
	if err := s.RecoverRunningOutputs(ctx); err != nil {
		t.Fatal(err)
	}
	job, err := s.ClaimOutput(ctx, "new-leader")
	if err != nil || job == nil {
		t.Fatal(err)
	}
	if job.ID != task.ID || job.Payload.MessageID != "" || !job.Payload.PinMessage {
		t.Fatal("recovery mixed cleanup and redraw", job)
	}
	if next, err := s.ClaimOutput(ctx, "new-leader"); err != nil || next != nil {
		t.Fatal("channel claimed twice", next, err)
	}
	rpWrite(t, store, func(r application.Repository) error {
		job.State, job.Executor = application.OutputSucceeded, ""
		return r.PutOutput(ctx, *job)
	})
	cleanup, err := s.ClaimOutput(ctx, "new-leader")
	if err != nil || cleanup == nil || cleanup.ID != successor.ID || cleanup.Payload.MessageID != "300" {
		t.Fatal("recovery lost deletion intent", cleanup, err)
	}
}

func TestOutputRateLimitKeepsNonceAndDoesNotCountFailure(t *testing.T) {
	_, store := rpSetup(t)
	ctx := t.Context()
	clock := &fixedClock{time.Now().UTC().Truncate(time.Millisecond)}
	s := application.New(store, clock, ids{})
	task := queuedOutput("100", application.OutputTaskCard, clock.now)
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, task); return err })
	claimed, err := s.ClaimOutput(ctx, "leader")
	if err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	first, err := s.BeginOutputDispatch(ctx, task.ID, "leader", "message", "100", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FailOutput(ctx, task.ID, "leader", first.ID, &application.DiscordFailure{Kind: application.DiscordRateLimited, RetryAfter: 2500 * time.Millisecond}); err != nil {
		t.Fatal(err)
	}
	if early, err := s.ClaimOutput(ctx, "leader"); err != nil || early != nil {
		t.Fatal("rate limit ignored", early, err)
	}
	clock.now = clock.now.Add(3 * time.Second)
	claimed, err = s.ClaimOutput(ctx, "leader")
	if err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	if claimed.Attempts != 0 {
		t.Fatal("429 increased failure count")
	}
	second, err := s.BeginOutputDispatch(ctx, task.ID, "leader", "message", "100", false)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || second.Nonce != first.Nonce || second.Attempt != 2 {
		t.Fatal("logical nonce or per-attempt ID changed incorrectly", first, second)
	}
	if err := s.FailOutput(ctx, task.ID, "leader", second.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		job, err := r.GetOutput(ctx, task.ID, false)
		if err != nil {
			return err
		}
		if job.State != application.OutputUncertain {
			t.Fatal("unknown create made retryable")
		}
		return nil
	})
}

func TestOutputCompoundThreadKeepsConfirmedParentWhenThreadResultIsUnknown(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	task := queuedOutput("100", application.OutputThreadEnsure, now)
	task.Payload.ThreadPurpose = "reminder_notice"
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutRemindChannel(ctx, &domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "reminders"}}); err != nil {
			return err
		}
		_, err := r.EnqueueOutput(ctx, task)
		return err
	})
	if job, err := s.ClaimOutput(ctx, "leader"); err != nil || job == nil {
		t.Fatal(job, err)
	}
	parent, err := s.BeginOutputDispatch(ctx, task.ID, "leader", "parent", "100", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteOutputDispatch(ctx, task.ID, "leader", "parent", parent.ID, "200", false); err != nil {
		t.Fatal(err)
	}
	thread, err := s.BeginOutputDispatch(ctx, task.ID, "leader", "thread", "100", true)
	if err != nil {
		t.Fatal(err)
	}
	if thread.Nonce != "" || thread.ID == parent.ID {
		t.Fatal("compound stages share a dispatch or thread has nonce")
	}
	if err := s.FailOutput(ctx, task.ID, "leader", thread.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		channel, err := r.GetRemindChannel(ctx, "100", false)
		if err != nil {
			return err
		}
		job, err := r.GetOutput(ctx, task.ID, false)
		if err != nil {
			return err
		}
		if channel.RemindNoticeMessageID == nil || *channel.RemindNoticeMessageID != "200" || channel.RemindNoticeThreadID != nil {
			t.Fatal("partial stage IDs lost or invented")
		}
		if job.State != application.OutputUncertain || !job.Payload.Stages[0].Done || job.Payload.Stages[1].Done {
			t.Fatal("compound creation progress incorrect")
		}
		return nil
	})
}
