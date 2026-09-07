package application

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

const notificationExpired = "通知条件が失効"
const notificationAwaitingDestination = "通知先の準備待ち"

type preparedNotification struct {
	channelID, destination string
	message                DisplayMessage
}

// Preparation takes the business parent lock before the output lock, matching
// business writes and acknowledgement. No transaction spans a Discord request.
func (s *Service) prepareNotification(ctx context.Context, taskID, executor string) (*preparedNotification, error) {
	var result *preparedNotification
	err := s.store.Write(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, false)
		if err != nil {
			return err
		}
		if job == nil {
			return domain.Fail(domain.CodeNotFound, taskID, "Output not found")
		}
		var list *domain.List
		var ch *domain.RemindChannelSettings
		switch job.Kind {
		case OutputListDeadlineNotice:
			list, err = r.GetList(ctx, job.ChannelID, true)
		case OutputReminderNotice:
			ch, err = r.GetRemindChannel(ctx, job.ChannelID, true)
		default:
			return domain.Fail(domain.CodeInvalidInput, taskID, "Not a notification task")
		}
		if err != nil {
			return err
		}
		job, err = r.GetOutput(ctx, taskID, true)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		n := job.Payload.Notification
		if n == nil {
			return domain.Fail(domain.CodeInvalidInput, taskID, "Missing notification evidence")
		}
		now := s.now()
		display := Notification{NotificationToken: NotificationToken{Kind: n.Kind, ChannelID: job.ChannelID, ID: job.TargetID, EvaluatedAt: now, TargetDueAt: n.TargetDueAt}}
		eligible, destination := false, ""
		if job.Kind == OutputListDeadlineNotice {
			if n.Kind != domain.NotificationList {
				return domain.Fail(domain.CodeInvalidInput, taskID, "Invalid list notification kind")
			}
			if list != nil {
				for _, item := range list.Items {
					if item.ID == job.TargetID && item.Until != nil && *item.Until == n.TargetDueAt && domain.ShouldNotifyList(item, now) {
						eligible = true
						display.List, display.Item = &ListDisplay{Channel: list.Channel, Items: list.Items}, &item
						break
					}
				}
				if list.Channel.OperationLogThreadID != nil {
					destination = *list.Channel.OperationLogThreadID
				} else {
					eligible = false
				}
			}
		} else {
			revision, err := strconv.ParseInt(n.ExpectedRevision, 10, 64)
			if err != nil {
				return domain.Fail(domain.CodeInvalidInput, taskID, "Invalid notification revision")
			}
			due, err := time.Parse(time.RFC3339Nano, n.TargetDueAt)
			if err != nil {
				return domain.Fail(domain.CodeInvalidInput, taskID, "Invalid notification deadline")
			}
			if n.Kind != domain.NotificationBefore && n.Kind != domain.NotificationOverdue {
				return domain.Fail(domain.CodeInvalidInput, taskID, "Invalid notification kind")
			}
			if ch != nil {
				task, err := r.GetTask(ctx, job.ChannelID, job.TargetID, false)
				if err != nil {
					return err
				}
				if task != nil && task.MessageID != nil && task.Revision == revision && task.NextDueAt.Equal(due) {
					eligible = n.Kind == domain.NotificationBefore && domain.ShouldSendPreReminder(*task, now) || n.Kind == domain.NotificationOverdue && n.NotificationDay == domain.TokyoDate(now) && domain.ShouldSendOverdue(*task, now)
					if eligible {
						reader := displayReader{repository: r}
						d, err := reader.task(ctx, *ch, *task)
						if err != nil {
							return err
						}
						display.Reminder = &d
					}
				}
				if ch.RemindNoticeMessageID != nil && ch.RemindNoticeThreadID != nil {
					destination = *ch.RemindNoticeThreadID
				}
			}
		}
		if !eligible {
			job.State, job.Executor, job.LastError, job.UpdatedAt = OutputCancelled, "", notificationExpired, now
			return r.PutOutput(ctx, *job)
		}
		if destination == "" {
			if ch != nil {
				dependency, err := s.reserveThreadEnsureID(ctx, r, outputChannel{ch.ChannelID, "reminder"}, "reminder_notice", false)
				if err != nil {
					return err
				}
				job.Payload.DependencyTaskID = dependency
			}
			job.State, job.Executor, job.LastError, job.UpdatedAt = OutputRetryWait, "", notificationAwaitingDestination, now
			job.AvailableAt = now.Add(time.Minute)
			return r.PutOutput(ctx, *job)
		}
		message, err := RenderNotification(display)
		if err != nil {
			return err
		}
		n.EvaluatedAt = now
		job.UpdatedAt = now
		if err := r.PutOutput(ctx, *job); err != nil {
			return err
		}
		result = &preparedNotification{channelID: job.ChannelID, destination: destination, message: message}
		return nil
	})
	return result, err
}

func (s *Service) ExecuteNotification(ctx context.Context, gateway DiscordGateway, botID, taskID, executor string) error {
	prepared, err := s.prepareNotification(ctx, taskID, executor)
	if err != nil || prepared == nil {
		return err
	}
	if !discordID.MatchString(botID) || !discordID.MatchString(prepared.destination) {
		return s.FailOutput(ctx, taskID, executor, "", &DiscordFailure{Kind: DiscordRejected})
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	thread, err := gateway.GetThread(ctx, prepared.destination)
	if err != nil {
		return s.FailOutput(ctx, taskID, executor, "", err)
	}
	if thread.ID != prepared.destination || thread.ParentID != prepared.channelID {
		return s.FailOutput(ctx, taskID, executor, "", &DiscordFailure{Kind: DiscordRejected})
	}
	if thread.Archived {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := gateway.UnarchiveThread(ctx, thread.ID); err != nil {
			return s.FailOutput(ctx, taskID, executor, "", err)
		}
	}
	// A pause, deadline edit or date rollover during the lookup must prevent POST.
	prepared, err = s.prepareNotification(ctx, taskID, executor)
	if err != nil || prepared == nil {
		return err
	}
	if prepared.destination != thread.ID {
		return s.FailOutput(ctx, taskID, executor, "", errors.New("notification destination changed during lookup"))
	}
	dispatch, err := s.BeginOutputDispatch(ctx, taskID, executor, "message", thread.ID, false)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	message, err := gateway.CreateMessage(ctx, thread.ID, prepared.message, dispatch.Nonce)
	if err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, err)
	}
	if message.ChannelID != thread.ID || message.AuthorID != botID || !message.AuthorIsBot || !discordID.MatchString(message.ID) || message.Nonce != "" && message.Nonce != dispatch.Nonce {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	if err := s.CompleteOutputDispatch(ctx, taskID, executor, "message", dispatch.ID, message.ID, true); err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	return nil
}
