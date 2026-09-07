package application

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// CompleteOutputDispatch stores the confirmed ID and dispatch result together.
// It locks business parents before updating the outbox, matching business writes.
// The caller must already have checked the Discord result's destination/author.
func (s *Service) CompleteOutputDispatch(ctx context.Context, taskID, executor, stageName, dispatchID, messageID string, final bool) error {
	if !discordID.MatchString(messageID) {
		return domain.Fail(domain.CodeInvalidInput, "messageId", "Invalid Discord ID")
	}
	return s.store.Write(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, false)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		index := -1
		for i, stage := range job.Payload.Stages {
			if stage.Name == stageName && stage.CurrentDispatchID == dispatchID && !stage.Done {
				index = i
				break
			}
		}
		if index < 0 {
			return domain.Fail(domain.CodeConflict, stageName, "Output stage does not match dispatch")
		}
		history, err := r.OutputDispatches(ctx, taskID)
		if err != nil {
			return err
		}
		var dispatch *OutputDispatch
		for i := range history {
			if history[i].ID == dispatchID && history[i].Outcome == DispatchUnknown {
				dispatch = &history[i]
				break
			}
		}
		if dispatch == nil {
			return domain.Fail(domain.CodeConflict, dispatchID, "Dispatch is not awaiting a result")
		}
		if err := s.storeCreatedOutputID(ctx, r, *job, stageName, messageID); err != nil {
			return err
		}
		// Ownership may have changed while waiting for a business parent lock.
		// Recheck under the outbox row lock after acquiring business locks.
		current, err := r.GetOutput(ctx, taskID, true)
		if err != nil {
			return err
		}
		if current == nil || current.State != OutputRunning || current.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		now := s.now()
		dispatch.Outcome, dispatch.DiscordMessageID, dispatch.FinishedAt = DispatchSucceeded, messageID, &now
		if err := r.PutDispatch(ctx, *dispatch); err != nil {
			return err
		}
		job.Payload.Stages[index].MessageID = messageID
		job.Payload.Stages[index].Done = true
		job.UpdatedAt, job.LastError = now, ""
		if final {
			job.State, job.Executor = OutputSucceeded, ""
		}
		return r.PutOutput(ctx, *job)
	})
}

func (s *Service) orphanOutput(ctx context.Context, r Repository, job OutputTask, messageID string) error {
	id, err := s.ids.NewID()
	if err != nil {
		return err
	}
	now := s.now()
	_, err = r.EnqueueOutput(ctx, OutputTask{ID: id, ChannelID: job.ChannelID, TargetID: job.TargetID, DestinationKey: job.DestinationKey, Kind: job.Kind, State: OutputPending, AvailableAt: now, CreatedAt: now, UpdatedAt: now, Payload: OutputPayload{MessageID: messageID}})
	return err
}

func (s *Service) storeCreatedOutputID(ctx context.Context, r Repository, job OutputTask, stage, messageID string) error {
	switch job.Kind {
	case OutputListRender:
		list, err := r.GetList(ctx, job.ChannelID, true)
		if err != nil {
			return err
		}
		if list == nil {
			return s.orphanOutput(ctx, r, job, messageID)
		}
		list.Channel.MessageID = &messageID
		return r.PutList(ctx, list)
	case OutputInventoryRender:
		catalog, err := r.GetCatalog(ctx, job.ChannelID, true)
		if err != nil {
			return err
		}
		if catalog == nil {
			return s.orphanOutput(ctx, r, job, messageID)
		}
		catalog.Channel.MessageID = &messageID
		return r.PutCatalog(ctx, catalog)
	case OutputTaskCard:
		channel, err := r.GetRemindChannel(ctx, job.ChannelID, true)
		if err != nil {
			return err
		}
		if channel == nil {
			return s.orphanOutput(ctx, r, job, messageID)
		}
		task, err := r.GetTask(ctx, job.ChannelID, job.TargetID, true)
		if err != nil {
			return err
		}
		if task == nil {
			return s.orphanOutput(ctx, r, job, messageID)
		}
		task.MessageID = &messageID
		return r.PutTask(ctx, task, channel.LinkedInventoryChannelID, false)
	case OutputThreadEnsure:
		if job.Payload.ThreadPurpose == "reminder_notice" {
			channel, err := getRemind(ctx, r, job.ChannelID, true)
			if err != nil {
				return err
			}
			switch stage {
			case "parent":
				channel.RemindNoticeMessageID = &messageID
			case "thread":
				channel.RemindNoticeThreadID = &messageID
			default:
				return domain.Fail(domain.CodeInvalidInput, stage, "Invalid reminder thread stage")
			}
			return r.PutRemindChannel(ctx, channel)
		}
		if job.Payload.ThreadPurpose != "operation_log" || stage != "thread" {
			return domain.Fail(domain.CodeInvalidInput, stage, "Invalid output thread purpose")
		}
		switch job.Payload.ChannelKind {
		case "list":
			list, err := getList(ctx, r, job.ChannelID, true)
			if err != nil {
				return err
			}
			list.Channel.OperationLogThreadID = &messageID
			return r.PutList(ctx, list)
		case "inventory":
			catalog, err := getCatalog(ctx, r, job.ChannelID, true)
			if err != nil {
				return err
			}
			catalog.Channel.OperationLogThreadID = &messageID
			return r.PutCatalog(ctx, catalog)
		case "reminder":
			channel, err := getRemind(ctx, r, job.ChannelID, true)
			if err != nil {
				return err
			}
			channel.OperationLogThreadID = &messageID
			return r.PutRemindChannel(ctx, channel)
		default:
			return domain.Fail(domain.CodeInvalidInput, job.Payload.ChannelKind, "Invalid output channel kind")
		}
	case OutputReminderNotice, OutputListDeadlineNotice:
		return s.acknowledgeOutputNotification(ctx, r, job)
	case OutputOperationLog:
		return nil
	default:
		return domain.Fail(domain.CodeInvalidInput, string(job.Kind), "Output kind does not create messages")
	}
}
