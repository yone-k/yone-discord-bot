//go:build integration

package repository_test

import (
	"strconv"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestNotificationReservationsDeduplicatePerDeadlineAndTokyoDay(t *testing.T) {
	_, store := rpSetup(t)
	ctx := t.Context()
	now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
	_, ch, task := rpSeedCatalogTask(t, store)
	task.IsPaused, task.OverdueNotifyCount, task.LastOverdueNotifiedAt = false, 0, nil
	task.NextDueAt = now.Add(-time.Hour)
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false); err != nil {
			return err
		}
		id := rpID()
		day := domain.TokyoDate(now)
		return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list", OperationLogThreadID: rpPtr("101")}, DefaultCategory: "その他"}, Items: []domain.ListItem{{ID: id, Name: "milk", Until: &day}}})
	})
	s := application.New(store, fixedClock{now}, ids{})
	for i := 0; i < 2; i++ {
		if err := s.ReserveNotifications(ctx); err != nil {
			t.Fatal(err)
		}
	}
	s = application.New(store, fixedClock{now.Add(24 * time.Hour)}, ids{})
	if err := s.ReserveNotifications(ctx); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{})
		if err != nil {
			return err
		}
		counts := map[application.OutputKind]int{}
		days := map[string]bool{}
		for _, job := range jobs {
			counts[job.Kind]++
			if job.Payload.Notification == nil {
				t.Fatal("notification data not persisted")
			}
			if job.Kind == application.OutputReminderNotice {
				days[job.Payload.Notification.NotificationDay] = true
			}
		}
		if len(jobs) != 3 || counts[application.OutputReminderNotice] != 2 || counts[application.OutputListDeadlineNotice] != 1 || len(days) != 2 {
			t.Fatal("incorrect notification deduplication", counts, days)
		}
		return nil
	})
}

func TestNotificationResultAndAckCommitAtomically(t *testing.T) {
	for _, scenario := range []string{"success", "changed revision", "result save failure"} {
		t.Run(scenario, func(t *testing.T) {
			db, store := rpSetup(t)
			_, ch, task := rpSeedCatalogTask(t, store)
			ctx, now := t.Context(), time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
			task.IsPaused, task.OverdueNotifyCount, task.LastOverdueNotifiedAt = false, 0, nil
			task.NextDueAt = now.Add(-time.Hour)
			job := queuedOutput(ch.ChannelID, application.OutputReminderNotice, now)
			job.TargetID = task.ID
			job.Payload.Notification = &application.OutputNotification{Kind: domain.NotificationOverdue, TargetDueAt: task.NextDueAt.Format(time.RFC3339Nano), ExpectedRevision: strconv.FormatInt(task.Revision, 10), NotificationDay: domain.TokyoDate(now), EvaluatedAt: now}
			rpWrite(t, store, func(r application.Repository) error {
				if err := r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, job)
				return err
			})
			s := application.New(store, fixedClock{now}, ids{})
			if claimed, err := s.ClaimOutput(ctx, "leader"); err != nil || claimed == nil {
				t.Fatal(claimed, err)
			}
			dispatch, err := s.BeginOutputDispatch(ctx, job.ID, "leader", "message", *ch.RemindNoticeThreadID, false)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "changed revision" {
				task.Revision++
				rpWrite(t, store, func(r application.Repository) error { return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false) })
			}
			if scenario == "result save failure" {
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_output_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.outcome='succeeded' THEN RAISE EXCEPTION 'injected result save failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_output_result BEFORE UPDATE ON output_dispatches FOR EACH ROW EXECUTE FUNCTION reject_output_result()`); err != nil {
					t.Fatal(err)
				}
			}
			err = s.CompleteOutputDispatch(ctx, job.ID, "leader", "message", dispatch.ID, "900", true)
			if (err != nil) != (scenario == "result save failure") {
				t.Fatal("unexpected result save", err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stored, err := r.GetTask(ctx, ch.ChannelID, task.ID, false)
				if err != nil {
					return err
				}
				acked := scenario == "success"
				if (stored.LastOverdueNotifiedAt != nil) != acked {
					t.Fatal("incorrect notification acknowledgement", stored)
				}
				wantCount := 0
				if acked {
					wantCount = 1
				}
				if stored.OverdueNotifyCount != wantCount {
					t.Fatal(stored.OverdueNotifyCount)
				}
				jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: ch.ChannelID})
				if err != nil {
					return err
				}
				cards := 0
				for _, job := range jobs {
					if job.Kind == application.OutputTaskCard {
						cards++
					}
				}
				if cards != wantCount {
					t.Fatal("card not atomic with acknowledgement", cards)
				}
				return nil
			})
		})
	}
}

func TestNotificationWithMissingLegacyDestinationPersistsHold(t *testing.T) {
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
		return r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false)
	})
	s := application.New(store, fixedClock{now}, ids{})
	if err := s.ReserveNotifications(ctx); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: ch.ChannelID})
		if err != nil {
			return err
		}
		if len(jobs) != 2 {
			t.Fatal("notification or dependency was discarded", jobs)
		}
		for _, job := range jobs {
			if job.Kind == application.OutputThreadEnsure && (job.State != application.OutputUncertain || job.LastError != "既存通知先の所在不明") {
				t.Fatal("missing destination not held", job)
			}
		}
		return nil
	})
}
