package application

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// reserveNurseryMenuNotice queues today's menu once per Tokyo day. The day is
// claimed across channels, so moving the destination never posts it twice.
func (s *Service) reserveNurseryMenuNotice(ctx context.Context) error {
	return s.store.Write(ctx, func(r Repository) error {
		now := s.now()
		if !domain.ShouldPostNurseryMenu(now) {
			return nil
		}
		if err := r.LockOutputQueue(ctx); err != nil {
			return err
		}
		channel, err := r.GetNurseryMenuChannel(ctx)
		if err != nil || channel == nil {
			return err
		}
		date := domain.TokyoDate(now)
		menu, err := r.GetNurseryMenu(ctx, date)
		if err != nil || menu == nil {
			return err
		}
		exists, err := r.NurseryMenuNoticeExists(ctx, date)
		if err != nil || exists {
			return err
		}
		id, err := s.ids.NewID()
		if err != nil {
			return err
		}
		notification := OutputNotification{Kind: domain.NotificationNurseryMenu, TargetDueAt: date, NotificationDay: date, EvaluatedAt: now}
		task := OutputTask{ID: id, ChannelID: *channel, TargetID: date, Kind: OutputNurseryMenuNotice, DestinationKey: string(OutputNurseryMenuNotice) + ":" + date, State: OutputPending, AvailableAt: now, CreatedAt: now, UpdatedAt: now, Payload: OutputPayload{DestinationID: *channel, Notification: &notification}}
		storedID, err := r.EnqueueOutput(ctx, task)
		if err != nil || storedID == id {
			return err
		}
		// The same channel's earlier notice was cancelled without delivery
		// evidence (NurseryMenuNoticeExists excluded it); send it again.
		stored, err := r.GetOutput(ctx, storedID, true)
		if err != nil || stored == nil || stored.State != OutputCancelled || stored.LastError != notificationExpired {
			return err
		}
		stored.State, stored.Executor, stored.LastError = OutputPending, "", ""
		stored.AvailableAt, stored.UpdatedAt = now, now
		stored.Payload.Notification = &notification
		return r.PutOutput(ctx, *stored)
	})
}

// prepareNurseryMenuNotice rechecks every posting condition under the output
// row lock. Any change since reservation cancels the notice before a POST.
func (s *Service) prepareNurseryMenuNotice(ctx context.Context, taskID, executor string) (*DisplayMessage, string, error) {
	var message *DisplayMessage
	var destination string
	err := s.store.Write(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, true)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		if job.Kind != OutputNurseryMenuNotice {
			return domain.Fail(domain.CodeInvalidInput, taskID, "Not a nursery menu notice")
		}
		now := s.now()
		channel, err := r.GetNurseryMenuChannel(ctx)
		if err != nil {
			return err
		}
		var menu *domain.NurseryMenu
		if domain.ShouldPostNurseryMenu(now) && job.TargetID == domain.TokyoDate(now) && channel != nil && *channel == job.ChannelID {
			if menu, err = r.GetNurseryMenu(ctx, job.TargetID); err != nil {
				return err
			}
		}
		if menu == nil {
			job.State, job.Executor, job.LastError, job.UpdatedAt = OutputCancelled, "", notificationExpired, now
			return r.PutOutput(ctx, *job)
		}
		rendered := RenderNurseryMenu(*menu)
		message, destination = &rendered, job.ChannelID
		return nil
	})
	return message, destination, err
}

func (s *Service) ExecuteNurseryMenuNotice(ctx context.Context, gateway DiscordGateway, botID, taskID, executor string) error {
	message, destination, err := s.prepareNurseryMenuNotice(ctx, taskID, executor)
	if err != nil || message == nil {
		return err
	}
	if !discordID.MatchString(botID) || !discordID.MatchString(destination) {
		return s.FailOutput(ctx, taskID, executor, "", &DiscordFailure{Kind: DiscordRejected})
	}
	dispatch, err := s.BeginOutputDispatch(ctx, taskID, executor, "message", destination, false)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	created, err := gateway.CreateMessage(ctx, destination, *message, dispatch.Nonce)
	if err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, err)
	}
	if created.ChannelID != destination || created.AuthorID != botID || !created.AuthorIsBot || !discordID.MatchString(created.ID) || created.Nonce != "" && created.Nonce != dispatch.Nonce {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	if err := s.CompleteOutputDispatch(ctx, taskID, executor, "message", dispatch.ID, created.ID, true); err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	return nil
}
