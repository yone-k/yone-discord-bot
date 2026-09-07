package application

import (
	"context"
	"strconv"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// ReserveNotifications is called in-process by the worker's notification tick.
// Candidate reads are followed by a fresh check under the business parent lock.
func (s *Service) ReserveNotifications(ctx context.Context) error {
	plan, err := s.PollNotifications(ctx)
	if err != nil {
		return err
	}
	for _, notification := range plan.Notifications {
		if err := s.reserveNotification(ctx, notification.NotificationToken); err != nil {
			return err
		}
	}
	for _, progress := range plan.Progress {
		if err := s.store.Write(ctx, func(r Repository) error {
			ch, err := r.GetRemindChannel(ctx, progress.Reminder.Channel.ChannelID, true)
			if err != nil || ch == nil {
				return err
			}
			task, err := r.GetTask(ctx, ch.ChannelID, progress.Reminder.Task.ID, false)
			if err != nil || task == nil {
				return err
			}
			if task.IsPaused || task.MessageID == nil {
				return nil
			}
			return s.reserveCardOutput(ctx, r, ch.ChannelID, task.ID, OutputTaskCard, "", OutputPayload{})
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reserveNotification(ctx context.Context, candidate NotificationToken) error {
	return s.store.Write(ctx, func(r Repository) error {
		now := s.now()
		notification := OutputNotification{Kind: candidate.Kind, TargetDueAt: candidate.TargetDueAt, EvaluatedAt: now}
		kind := OutputListDeadlineNotice
		dependencyID := ""
		if candidate.Kind == domain.NotificationList {
			list, err := r.GetList(ctx, candidate.ChannelID, true)
			if err != nil || list == nil {
				return err
			}
			if list.Channel.OperationLogThreadID == nil {
				return nil
			}
			eligible := false
			for _, item := range list.Items {
				if item.ID == candidate.ID && item.Until != nil && *item.Until == candidate.TargetDueAt && domain.ShouldNotifyList(item, now) {
					eligible = true
					break
				}
			}
			if !eligible {
				return nil
			}
		} else {
			kind = OutputReminderNotice
			ch, err := r.GetRemindChannel(ctx, candidate.ChannelID, true)
			if err != nil || ch == nil {
				return err
			}
			task, err := r.GetTask(ctx, candidate.ChannelID, candidate.ID, false)
			if err != nil || task == nil {
				return err
			}
			due, err := time.Parse(time.RFC3339Nano, candidate.TargetDueAt)
			if err != nil {
				return err
			}
			if !task.NextDueAt.Equal(due) || task.MessageID == nil {
				return nil
			}
			switch candidate.Kind {
			case domain.NotificationBefore:
				if !domain.ShouldSendPreReminder(*task, now) {
					return nil
				}
			case domain.NotificationOverdue:
				if !domain.ShouldSendOverdue(*task, now) {
					return nil
				}
				notification.NotificationDay = domain.TokyoDate(now)
			default:
				return domain.Fail(domain.CodeInvalidInput, "kind", "Invalid notification kind")
			}
			notification.ExpectedRevision = strconv.FormatInt(task.Revision, 10)
			if ch.RemindNoticeMessageID == nil || ch.RemindNoticeThreadID == nil {
				dependencyID, err = s.reserveThreadEnsureID(ctx, r, outputChannel{ch.ChannelID, "reminder"}, "reminder_notice", false)
				if err != nil {
					return err
				}
			}
		}
		id, err := s.ids.NewID()
		if err != nil {
			return err
		}
		storedID, err := r.EnqueueOutput(ctx, OutputTask{ID: id, ChannelID: candidate.ChannelID, TargetID: candidate.ID, Kind: kind, DestinationKey: string(kind) + ":" + candidate.ID, State: OutputPending, AvailableAt: now, CreatedAt: now, UpdatedAt: now, Payload: OutputPayload{Notification: &notification, DependencyTaskID: dependencyID}})
		if err != nil || storedID == id {
			return err
		}
		// A resumed task may qualify for the same deadline again. Only revive
		// condition-expired work with explicit evidence that no POST succeeded.
		// Manual cancellation and uncertain/successful work retain their state.
		stored, err := r.GetOutput(ctx, storedID, true)
		if err != nil {
			return err
		}
		if stored == nil || stored.State != OutputCancelled || stored.LastError != notificationExpired {
			return nil
		}
		history, err := r.OutputDispatches(ctx, storedID)
		if err != nil {
			return err
		}
		for _, dispatch := range history {
			if dispatch.Outcome != DispatchFailed {
				return nil
			}
		}
		stored.State, stored.Executor, stored.LastError = OutputPending, "", ""
		stored.AvailableAt, stored.UpdatedAt = now, now
		stored.Payload.Notification = &notification
		stored.Payload.DependencyTaskID = dependencyID
		return r.PutOutput(ctx, *stored)
	})
}
