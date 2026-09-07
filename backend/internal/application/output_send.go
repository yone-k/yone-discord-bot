package application

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// ExecuteOperationLog executes a claimed task using the leadership lease's
// context. All reads and writes finish before the next Discord request starts.
// A nil result means either success or a persisted retry/hold decision.
func (s *Service) ExecuteOperationLog(ctx context.Context, gateway DiscordGateway, botID, taskID, executor string) error {
	var job *OutputTask
	var operation *OperationRecord
	err := s.store.Read(ctx, func(r Repository) error {
		var err error
		job, err = r.GetOutput(ctx, taskID, false)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		if job.Kind != OutputOperationLog {
			return domain.Fail(domain.CodeInvalidInput, taskID, "Not an operation log task")
		}
		operation, err = r.GetOperation(ctx, job.OperationID)
		return err
	})
	if err != nil {
		return err
	}
	if operation == nil || operation.ChannelID != job.ChannelID || !discordID.MatchString(job.Payload.DestinationID) || !discordID.MatchString(botID) {
		return s.FailOutput(ctx, taskID, executor, "", &DiscordFailure{Kind: DiscordRejected})
	}
	content, err := FormatOperationLog(*operation)
	if err != nil {
		return s.FailOutput(ctx, taskID, executor, "", &DiscordFailure{Kind: DiscordRejected})
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	thread, err := gateway.GetThread(ctx, job.Payload.DestinationID)
	if err != nil {
		return s.FailOutput(ctx, taskID, executor, "", err)
	}
	if thread.ID != job.Payload.DestinationID || thread.ParentID != job.ChannelID {
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
	dispatch, err := s.BeginOutputDispatch(ctx, taskID, executor, "message", thread.ID, false)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	message, err := gateway.CreateMessage(ctx, thread.ID, DisplayMessage{Content: content}, dispatch.Nonce)
	if err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, err)
	}
	if message.ChannelID != thread.ID || message.AuthorID != botID || !message.AuthorIsBot || !discordID.MatchString(message.ID) || message.Nonce != "" && message.Nonce != dispatch.Nonce {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	if err := s.CompleteOutputDispatch(ctx, taskID, executor, "message", dispatch.ID, message.ID, true); err != nil {
		// The POST succeeded, so a failed result commit must never authorize resend.
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	return nil
}
