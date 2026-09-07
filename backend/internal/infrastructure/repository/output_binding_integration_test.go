//go:build integration

package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type bindingGateway struct {
	application.DiscordGateway
	message  application.DiscordMessage
	thread   application.DiscordThread
	messages []application.DiscordMessage
	onRead   func()
}

type restoredCardGateway struct {
	application.DiscordGateway
	oldError   error
	newMessage application.DiscordMessage
	onNew      func()
}

func (g restoredCardGateway) GetMessage(_ context.Context, _, id string) (application.DiscordMessage, error) {
	if id == "300" {
		return application.DiscordMessage{ID: "300"}, g.oldError
	}
	if g.onNew != nil {
		g.onNew()
	}
	return g.newMessage, nil
}

func TestRestoredCardReplacementRequiresOldMessageAbsenceAndPreservesHistory(t *testing.T) {
	for _, scenario := range []string{"success", "old exists", "permission denied", "wrong author", "changed binding", "audit failure"} {
		t.Run(scenario, func(t *testing.T) {
			db, store := rpSetup(t)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			s := application.New(store, fixedClock{now}, ids{})
			job := queuedOutput("100", application.OutputListRender, now)
			dispatchID := rpID()
			sentAt := now.Add(-time.Hour)
			job.State = application.OutputUncertain
			previous := application.OutputStage{Name: "message", DestinationID: "100", MessageID: "300", FirstDispatchID: dispatchID, CurrentDispatchID: dispatchID, Done: true}
			job.Payload = application.OutputPayload{Restored: true, Stages: []application.OutputStage{previous}}
			rpWrite(t, store, func(r application.Repository) error {
				if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list", MessageID: rpPtr("300")}, DefaultCategory: "other"}}); err != nil {
					return err
				}
				if _, err := r.EnqueueOutput(ctx, job); err != nil {
					return err
				}
				return r.PutDispatch(ctx, application.OutputDispatch{ID: dispatchID, TaskID: job.ID, Attempt: 1, Nonce: "saved-nonce", StartedAt: sentAt, FinishedAt: &sentAt, Outcome: application.DispatchSucceeded, DiscordMessageID: "300"})
			})
			gateway := restoredCardGateway{oldError: &application.DiscordFailure{Kind: application.DiscordUnknownMessage}, newMessage: application.DiscordMessage{ID: "301", ChannelID: "100", AuthorID: "999", AuthorIsBot: true, Nonce: "replacement-nonce"}}
			switch scenario {
			case "old exists":
				gateway.oldError = nil
			case "permission denied":
				gateway.oldError = &application.DiscordFailure{Kind: application.DiscordRejected, HTTPStatus: 403}
			case "wrong author":
				gateway.newMessage.AuthorID = "998"
			case "changed binding":
				gateway.onNew = func() {
					rpWrite(t, store, func(r application.Repository) error {
						list, err := r.GetList(ctx, "100", true)
						if err != nil {
							return err
						}
						list.Channel.MessageID = rpPtr("302")
						return r.PutList(ctx, list)
					})
				}
			case "audit failure":
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_replacement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER reject_replacement_audit BEFORE INSERT ON operation_records FOR EACH ROW EXECUTE FUNCTION reject_replacement_audit()`); err != nil {
					t.Fatal(err)
				}
			}
			err = s.BindOutput(ctx, gateway, "999", job.ID, "message", "301")
			if (err == nil) != (scenario == "success") {
				t.Fatal(err)
			}
			detail, err := s.GetOutputDetails(ctx, job.ID)
			if err != nil {
				t.Fatal(err)
			}
			if detail.Task.Payload.Stages[0] != previous || len(detail.Dispatches) != 1 || detail.Dispatches[0].DiscordMessageID != "300" || !detail.Dispatches[0].FinishedAt.Equal(sentAt) {
				t.Fatal("history rewritten", detail)
			}
			wantState := application.OutputUncertain
			if scenario == "success" {
				wantState = application.OutputRetryWait
			}
			if detail.Task.State != wantState {
				t.Fatal(detail)
			}
			rpRead(t, store, func(r application.Repository) error {
				list, err := r.GetList(ctx, "100", false)
				if err != nil {
					return err
				}
				want := "300"
				if scenario == "success" {
					want = "301"
				}
				if scenario == "changed binding" {
					want = "302"
				}
				if list.Channel.MessageID == nil || *list.Channel.MessageID != want {
					t.Fatal(list)
				}
				return nil
			})
		})
	}
}

func TestReplacementCardStageCanBeReconciledWithoutChangingPreviousStage(t *testing.T) {
	_, store := rpSetup(t)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	job := queuedOutput("100", application.OutputListRender, now)
	previous := application.OutputStage{Name: "message", DestinationID: "100", MessageID: "200", Done: true}
	job.Payload.Stages = []application.OutputStage{previous}
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list"}, DefaultCategory: "other"}}); err != nil {
			return err
		}
		_, err := r.EnqueueOutput(ctx, job)
		return err
	})
	if _, err := s.ClaimOutput(ctx, "worker"); err != nil {
		t.Fatal(err)
	}
	dispatch, err := s.BeginOutputDispatch(ctx, job.ID, "worker", "message:1", "100", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FailOutput(ctx, job.ID, "worker", dispatch.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
		t.Fatal(err)
	}
	message := application.DiscordMessage{ID: "300", ChannelID: "100", AuthorID: "999", AuthorIsBot: true, Nonce: dispatch.Nonce}
	gateway := bindingGateway{message: message, messages: []application.DiscordMessage{message}}
	if err := s.BindOutput(ctx, gateway, "999", job.ID, "message:2", "300"); err == nil {
		t.Fatal("unrecorded replacement stage accepted")
	}
	if resolved, err := s.ReconcileOutput(ctx, gateway, "999", job.ID, "message:1"); err != nil || !resolved {
		t.Fatal(resolved, err)
	}
	detail, err := s.GetOutputDetails(ctx, job.ID)
	if err != nil || len(detail.Task.Payload.Stages) != 2 || detail.Task.Payload.Stages[0] != previous || !detail.Task.Payload.Stages[1].Done || detail.Dispatches[0].DiscordMessageID != "300" {
		t.Fatal(detail, err)
	}
	rpRead(t, store, func(r application.Repository) error {
		list, err := r.GetList(ctx, "100", false)
		if err == nil && (list.Channel.MessageID == nil || *list.Channel.MessageID != "300") {
			t.Fatal(list)
		}
		return err
	})
}

func TestRestoredPendingLogWaitsForExplicitBindingWithoutInventingDispatch(t *testing.T) {
	_, store := rpSetup(t)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	job := queuedOutput("100", application.OutputOperationLog, now)
	job.State = application.OutputUncertain
	job.Payload = application.OutputPayload{DestinationID: "200", Restored: true}
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(ctx, job); return err })
	if claimed, err := s.ClaimOutput(ctx, "worker"); err != nil || claimed != nil {
		t.Fatal("restored pending output resent", claimed, err)
	}
	gateway := bindingGateway{message: application.DiscordMessage{ID: "300", ChannelID: "200", AuthorID: "999", AuthorIsBot: true}}
	if resolved, err := s.ReconcileOutput(ctx, gateway, "999", job.ID, "message"); err != nil || resolved {
		t.Fatal("missing history treated as proof", resolved, err)
	}
	if err := s.BindOutput(ctx, gateway, "999", job.ID, "message", "300"); err != nil {
		t.Fatal(err)
	}
	detail, err := s.GetOutputDetails(ctx, job.ID)
	if err != nil || detail.Task.State != application.OutputSucceeded || len(detail.Dispatches) != 0 || len(detail.Task.Payload.Stages) != 1 || detail.Task.Payload.Stages[0].MessageID != "300" {
		t.Fatal(detail, err)
	}
}

func TestRestoredConfirmedCardCanBeVerifiedWithoutRewritingSendHistory(t *testing.T) {
	_, store := rpSetup(t)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	job := queuedOutput("100", application.OutputListRender, now)
	dispatchID := rpID()
	sentAt := now.Add(-time.Hour)
	job.State = application.OutputUncertain
	job.Payload = application.OutputPayload{Restored: true, PinMessage: true, Stages: []application.OutputStage{{Name: "message", DestinationID: "100", MessageID: "300", FirstDispatchID: dispatchID, CurrentDispatchID: dispatchID, Done: true}}}
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list", MessageID: rpPtr("300")}, DefaultCategory: "other"}}); err != nil {
			return err
		}
		if _, err := r.EnqueueOutput(ctx, job); err != nil {
			return err
		}
		return r.PutDispatch(ctx, application.OutputDispatch{ID: dispatchID, TaskID: job.ID, Attempt: 1, Nonce: "saved-nonce", StartedAt: sentAt, FinishedAt: &sentAt, Outcome: application.DispatchSucceeded, DiscordMessageID: "300"})
	})
	gateway := bindingGateway{message: application.DiscordMessage{ID: "300", ChannelID: "100", AuthorID: "999", AuthorIsBot: true}}
	if resolved, err := s.ReconcileOutput(ctx, gateway, "999", job.ID, "message"); err != nil || !resolved {
		t.Fatal(resolved, err)
	}
	detail, err := s.GetOutputDetails(ctx, job.ID)
	if err != nil || detail.Task.State != application.OutputRetryWait || !detail.Task.Payload.PinMessage || !detail.Dispatches[0].FinishedAt.Equal(sentAt) {
		t.Fatal(detail, err)
	}
}

func TestNotificationBindingCommitsAcknowledgementAndAuditAtomically(t *testing.T) {
	for _, scenario := range []string{"success", "changed revision", "audit failure"} {
		t.Run(scenario, func(t *testing.T) {
			db, store := rpSetup(t)
			_, channel, task := rpSeedCatalogTask(t, store)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
			if err != nil {
				t.Fatal(err)
			}
			now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
			task.IsPaused, task.OverdueNotifyCount, task.LastOverdueNotifiedAt = false, 0, nil
			task.NextDueAt = now.Add(-time.Hour)
			rpWrite(t, store, func(r application.Repository) error {
				return r.PutTask(ctx, task, channel.LinkedInventoryChannelID, false)
			})
			s := application.New(store, fixedClock{now}, ids{})
			if err := s.ReserveNotifications(ctx); err != nil {
				t.Fatal(err)
			}
			job, err := s.ClaimOutput(ctx, "worker")
			if err != nil || job == nil || job.Kind != application.OutputReminderNotice {
				t.Fatal(job, err)
			}
			dispatch, err := s.BeginOutputDispatch(ctx, job.ID, "worker", "message", *channel.RemindNoticeThreadID, false)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.FailOutput(ctx, job.ID, "worker", dispatch.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
				t.Fatal(err)
			}
			gateway := bindingGateway{message: application.DiscordMessage{ID: "900", ChannelID: *channel.RemindNoticeThreadID, AuthorID: "999", AuthorIsBot: true, Nonce: dispatch.Nonce}}
			if scenario == "changed revision" {
				gateway.onRead = func() {
					task.Revision++
					rpWrite(t, store, func(r application.Repository) error {
						return r.PutTask(ctx, task, channel.LinkedInventoryChannelID, false)
					})
				}
			}
			if scenario == "audit failure" {
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_notice_binding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER reject_notice_binding_audit BEFORE INSERT ON operation_records FOR EACH ROW EXECUTE FUNCTION reject_notice_binding_audit()`); err != nil {
					t.Fatal(err)
				}
			}
			err = s.BindOutput(ctx, gateway, "999", job.ID, "message", "900")
			if (err != nil) != (scenario == "audit failure") {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				current, err := r.GetTask(ctx, channel.ChannelID, task.ID, false)
				if err != nil {
					return err
				}
				want := 0
				if scenario == "success" {
					want = 1
				}
				if current.OverdueNotifyCount != want {
					t.Fatal("incorrect notification acknowledgement", current)
				}
				return nil
			})
			detail, err := s.GetOutputDetails(ctx, job.ID)
			if err != nil {
				t.Fatal(err)
			}
			want := application.DispatchSucceeded
			if scenario == "audit failure" {
				want = application.DispatchUnknown
			}
			if detail.Dispatches[0].Outcome != want {
				t.Fatal(detail)
			}
		})
	}
}

func (g bindingGateway) GetThread(context.Context, string) (application.DiscordThread, error) {
	if g.onRead != nil {
		g.onRead()
	}
	return g.thread, nil
}

func TestCancelledLegacyReminderBindingRetainsHoldUntilBothIDsVerified(t *testing.T) {
	_, store := rpSetup(t)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	job := queuedOutput("100", application.OutputThreadEnsure, now)
	job.State = application.OutputUncertain
	job.Payload = application.OutputPayload{ChannelKind: "reminder", ThreadPurpose: "reminder_notice"}
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutRemindChannel(ctx, &domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "reminders"}}); err != nil {
			return err
		}
		_, err := r.EnqueueOutput(ctx, job)
		return err
	})
	if err := s.CancelOutput(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	gateway := bindingGateway{message: application.DiscordMessage{ID: "300", ChannelID: "100", AuthorID: "999", AuthorIsBot: true}, thread: application.DiscordThread{ID: "300", ParentID: "100", OwnerID: "999", Type: 11}}
	if err := s.BindOutput(ctx, gateway, "999", job.ID, "thread", "300"); err == nil {
		t.Fatal("unverified parent accepted")
	}
	if err := s.BindOutput(ctx, gateway, "999", job.ID, "parent", "300"); err != nil {
		t.Fatal(err)
	}
	detail, err := s.GetOutputDetails(ctx, job.ID)
	if err != nil || !detail.Task.Payload.HoldCreation {
		t.Fatal("partial binding lost hold", detail, err)
	}
	for _, thread := range []application.DiscordThread{{ID: "301", ParentID: "100", OwnerID: "999", Type: 11}, {ID: "300", ParentID: "101", OwnerID: "999", Type: 11}, {ID: "300", ParentID: "100", OwnerID: "998", Type: 11}, {ID: "300", ParentID: "100", OwnerID: "999", Type: 12}} {
		wrong := gateway
		wrong.thread = thread
		if err := s.BindOutput(ctx, wrong, "999", job.ID, "thread", thread.ID); err == nil {
			t.Fatal("invalid reminder thread accepted", thread)
		}
	}
	if err := s.BindOutput(ctx, gateway, "999", job.ID, "thread", "300"); err != nil {
		t.Fatal(err)
	}
	detail, err = s.GetOutputDetails(ctx, job.ID)
	if err != nil || detail.Task.Payload.HoldCreation || detail.Task.State != application.OutputCancelled {
		t.Fatal(detail, err)
	}
	rpRead(t, store, func(r application.Repository) error {
		channel, err := r.GetRemindChannel(ctx, "100", false)
		if err != nil {
			return err
		}
		if channel.RemindNoticeMessageID == nil || *channel.RemindNoticeMessageID != "300" || channel.RemindNoticeThreadID == nil || *channel.RemindNoticeThreadID != "300" {
			t.Fatal(channel)
		}
		return nil
	})
}

func TestCardBindingPreservesConcurrentDestinationChange(t *testing.T) {
	for _, concurrent := range []bool{false, true} {
		t.Run(map[bool]string{false: "bind", true: "concurrent binding"}[concurrent], func(t *testing.T) {
			_, store := rpSetup(t)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "outputctl"})
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			s := application.New(store, fixedClock{now}, ids{})
			job := queuedOutput("100", application.OutputListRender, now)
			rpWrite(t, store, func(r application.Repository) error {
				if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list"}, DefaultCategory: "other"}}); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, job)
				return err
			})
			if _, err := s.ClaimOutput(ctx, "worker"); err != nil {
				t.Fatal(err)
			}
			dispatch, err := s.BeginOutputDispatch(ctx, job.ID, "worker", "message", "100", false)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.FailOutput(ctx, job.ID, "worker", dispatch.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
				t.Fatal(err)
			}
			gateway := bindingGateway{message: application.DiscordMessage{ID: "300", ChannelID: "100", AuthorID: "999", AuthorIsBot: true, Nonce: dispatch.Nonce}}
			if concurrent {
				gateway.onRead = func() {
					rpWrite(t, store, func(r application.Repository) error {
						list, err := r.GetList(ctx, "100", true)
						if err != nil {
							return err
						}
						list.Channel.MessageID = rpPtr("301")
						return r.PutList(ctx, list)
					})
				}
			}
			err = s.BindOutput(ctx, gateway, "999", job.ID, "message", "300")
			if (err != nil) != concurrent {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				list, err := r.GetList(ctx, "100", false)
				if err != nil {
					return err
				}
				want := "300"
				if concurrent {
					want = "301"
				}
				if list.Channel.MessageID == nil || *list.Channel.MessageID != want {
					t.Fatal(list)
				}
				return nil
			})
		})
	}
}

func (g bindingGateway) GetMessage(context.Context, string, string) (application.DiscordMessage, error) {
	if g.onRead != nil {
		g.onRead()
	}
	return g.message, nil
}
func (g bindingGateway) ListMessages(context.Context, string, string, int) ([]application.DiscordMessage, error) {
	return g.messages, nil
}

func TestOutputBindingVerifiesIdentityAndDetectsConcurrentCancellation(t *testing.T) {
	for _, scenario := range []string{"success", "wrong author", "wrong destination", "wrong nonce", "concurrent cancel", "cancelled", "audit failure"} {
		t.Run(scenario, func(t *testing.T) {
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
			if err := s.FailOutput(ctx, job.ID, "worker", dispatch.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
				t.Fatal(err)
			}
			gateway := bindingGateway{message: application.DiscordMessage{ID: "300", ChannelID: "200", AuthorID: "999", AuthorIsBot: true, Nonce: dispatch.Nonce}}
			switch scenario {
			case "wrong author":
				gateway.message.AuthorID = "998"
			case "wrong destination":
				gateway.message.ChannelID = "201"
			case "wrong nonce":
				gateway.message.Nonce = "different"
			case "concurrent cancel":
				gateway.onRead = func() {
					if err := s.CancelOutput(ctx, job.ID); err != nil {
						t.Fatal(err)
					}
				}
			case "cancelled":
				if err := s.CancelOutput(ctx, job.ID); err != nil {
					t.Fatal(err)
				}
			case "audit failure":
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_binding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER reject_binding_audit BEFORE INSERT ON operation_records FOR EACH ROW EXECUTE FUNCTION reject_binding_audit()`); err != nil {
					t.Fatal(err)
				}
			}
			err = s.BindOutput(ctx, gateway, "999", job.ID, "message", "300")
			success := scenario == "success" || scenario == "cancelled"
			if (err == nil) != success {
				t.Fatal("unexpected bind result", err)
			}
			detail, err := s.GetOutputDetails(ctx, job.ID)
			if err != nil {
				t.Fatal(err)
			}
			if success {
				if detail.Dispatches[0].Outcome != application.DispatchSucceeded || detail.Dispatches[0].DiscordMessageID != "300" || detail.Task.Payload.HoldCreation {
					t.Fatal(detail)
				}
				want := application.OutputSucceeded
				if scenario == "cancelled" {
					want = application.OutputCancelled
				}
				if detail.Task.State != want {
					t.Fatal(detail.Task)
				}
			} else if detail.Dispatches[0].Outcome != application.DispatchUnknown {
				t.Fatal("unverified result committed", detail)
			}
		})
	}
}

func TestOutputReconciliationRequiresUniqueExactNonceEvidence(t *testing.T) {
	for _, scenario := range []string{"match", "no match", "missing nonce", "multiple matches"} {
		t.Run(scenario, func(t *testing.T) {
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
			if err := s.FailOutput(ctx, job.ID, "worker", dispatch.ID, &application.DiscordFailure{Kind: application.DiscordIndeterminate}); err != nil {
				t.Fatal(err)
			}
			message := application.DiscordMessage{ID: "300", ChannelID: "200", AuthorID: "999", AuthorIsBot: true, Nonce: dispatch.Nonce}
			gateway := bindingGateway{message: message, messages: []application.DiscordMessage{message}}
			switch scenario {
			case "no match":
				gateway.messages = nil
			case "missing nonce":
				gateway.messages[0].Nonce = ""
			case "multiple matches":
				message.ID = "301"
				gateway.messages = append(gateway.messages, message)
			}
			resolved, err := s.ReconcileOutput(ctx, gateway, "999", job.ID, "message")
			if (err != nil) != (scenario == "multiple matches") || resolved != (scenario == "match") {
				t.Fatal(resolved, err)
			}
			detail, err := s.GetOutputDetails(ctx, job.ID)
			if err != nil {
				t.Fatal(err)
			}
			if scenario != "match" && (detail.Task.State != application.OutputUncertain || detail.Dispatches[0].Outcome != application.DispatchUnknown) {
				t.Fatal("search absence authorized resend", detail)
			}
		})
	}
}
