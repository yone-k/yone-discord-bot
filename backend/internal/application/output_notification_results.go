package application

import (
	"context"
	"strconv"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// A confirmed old send remains a successful dispatch when the business target
// changed during HTTP. Only the matching target version may be acknowledged.
func (s *Service) acknowledgeOutputNotification(ctx context.Context, r Repository, job OutputTask) error {
	n := job.Payload.Notification
	if n == nil || n.EvaluatedAt.IsZero() {
		return domain.Fail(domain.CodeInvalidInput, "notification", "Notification evidence is missing")
	}
	if job.Kind == OutputListDeadlineNotice {
		if n.Kind != domain.NotificationList {
			return domain.Fail(domain.CodeInvalidInput, "kind", "Invalid list notification kind")
		}
		list, err := r.GetList(ctx, job.ChannelID, true)
		if err != nil || list == nil {
			return err
		}
		for i := range list.Items {
			item := &list.Items[i]
			if item.ID != job.TargetID {
				continue
			}
			if item.Until == nil || *item.Until != n.TargetDueAt || !domain.ShouldNotifyList(*item, n.EvaluatedAt) {
				return nil
			}
			changed, err := item.MarkNotified(n.TargetDueAt, n.EvaluatedAt)
			if err != nil {
				return err
			}
			if changed {
				return r.PutList(ctx, list)
			}
			return nil
		}
		return nil
	}
	if n.Kind != domain.NotificationBefore && n.Kind != domain.NotificationOverdue {
		return domain.Fail(domain.CodeInvalidInput, "kind", "Invalid task notification kind")
	}
	revision, err := strconv.ParseInt(n.ExpectedRevision, 10, 64)
	if err != nil {
		return domain.Fail(domain.CodeInvalidInput, "revision", "Invalid notification revision")
	}
	due, err := time.Parse(time.RFC3339Nano, n.TargetDueAt)
	if err != nil {
		return domain.Fail(domain.CodeInvalidInput, "deadline", "Invalid notification deadline")
	}
	ch, err := r.GetRemindChannel(ctx, job.ChannelID, true)
	if err != nil || ch == nil {
		return err
	}
	task, err := r.GetTask(ctx, job.ChannelID, job.TargetID, true)
	if err != nil || task == nil {
		return err
	}
	if task.Revision != revision || !task.NextDueAt.Equal(due) {
		return nil
	}
	if n.Kind == domain.NotificationBefore && !domain.ShouldSendPreReminder(*task, n.EvaluatedAt) || n.Kind == domain.NotificationOverdue && !domain.ShouldSendOverdue(*task, n.EvaluatedAt) {
		return nil
	}
	if err := task.MarkNotified(revision, due, n.Kind, n.EvaluatedAt); err != nil {
		return err
	}
	if err := r.PutTask(ctx, task, ch.LinkedInventoryChannelID, false); err != nil {
		return err
	}
	return s.reserveCardOutput(ctx, r, job.ChannelID, job.TargetID, OutputTaskCard, "", OutputPayload{})
}
