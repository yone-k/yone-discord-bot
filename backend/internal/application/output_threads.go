package application

import (
	"context"
	"errors"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type threadSnapshot struct {
	job                OutputTask
	parentID, threadID string
}

func (s *Service) threadSnapshot(ctx context.Context, taskID, executor string) (*threadSnapshot, error) {
	return read(s, ctx, func(r Repository) (*threadSnapshot, error) {
		job, err := r.GetOutput(ctx, taskID, false)
		if err != nil {
			return nil, err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return nil, domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		if job.Kind != OutputThreadEnsure {
			return nil, domain.Fail(domain.CodeInvalidInput, taskID, "Not a thread task")
		}
		out := &threadSnapshot{job: *job}
		var parent, thread *string
		if job.Payload.ThreadPurpose == "reminder_notice" && job.Payload.ChannelKind == "reminder" {
			ch, err := getRemind(ctx, r, job.ChannelID, false)
			if err != nil {
				return nil, err
			}
			parent, thread = ch.RemindNoticeMessageID, ch.RemindNoticeThreadID
		} else if job.Payload.ThreadPurpose == "operation_log" {
			switch job.Payload.ChannelKind {
			case "list":
				list, err := getList(ctx, r, job.ChannelID, false)
				if err != nil {
					return nil, err
				}
				thread = list.Channel.OperationLogThreadID
			case "inventory":
				catalog, err := getCatalog(ctx, r, job.ChannelID, false)
				if err != nil {
					return nil, err
				}
				thread = catalog.Channel.OperationLogThreadID
			case "reminder":
				ch, err := getRemind(ctx, r, job.ChannelID, false)
				if err != nil {
					return nil, err
				}
				thread = ch.OperationLogThreadID
			default:
				return nil, domain.Fail(domain.CodeInvalidInput, "channelKind", "Invalid thread channel kind")
			}
		} else {
			return nil, domain.Fail(domain.CodeInvalidInput, "purpose", "Invalid thread purpose")
		}
		if parent != nil {
			out.parentID = *parent
		}
		if thread != nil {
			out.threadID = *thread
		}
		return out, nil
	})
}

func (s *Service) ExecuteThreadEnsure(ctx context.Context, gateway DiscordGateway, botID, taskID, executor string) error {
	state, err := s.threadSnapshot(ctx, taskID, executor)
	if err != nil {
		return err
	}
	reminder := state.job.Payload.ThreadPurpose == "reminder_notice"
	if !state.job.Payload.AllowCreate && (state.threadID == "" || reminder && state.parentID == "") {
		return s.holdUnknownDestination(ctx, taskID, executor)
	}
	if !discordID.MatchString(botID) {
		return s.FailOutput(ctx, taskID, executor, "", &DiscordFailure{Kind: DiscordRejected})
	}
	if reminder {
		if state.parentID == "" {
			dispatch, err := s.BeginOutputDispatch(ctx, taskID, executor, "parent", state.job.ChannelID, false)
			if err != nil {
				return err
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			message, err := gateway.CreateMessage(ctx, state.job.ChannelID, RenderReminderNoticeParent(), dispatch.Nonce)
			if err != nil {
				return s.FailOutput(ctx, taskID, executor, dispatch.ID, err)
			}
			if message.ChannelID != state.job.ChannelID || message.AuthorID != botID || !message.AuthorIsBot || !discordID.MatchString(message.ID) || message.Nonce != "" && message.Nonce != dispatch.Nonce {
				return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
			}
			if err := s.CompleteOutputDispatch(ctx, taskID, executor, "parent", dispatch.ID, message.ID, false); err != nil {
				return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
			}
			state.parentID = message.ID
		} else {
			if err := ctx.Err(); err != nil {
				return err
			}
			parent, err := gateway.GetMessage(ctx, state.job.ChannelID, state.parentID)
			if err != nil {
				return s.threadReadFailure(ctx, taskID, executor, err)
			}
			if parent.ID != state.parentID || parent.ChannelID != state.job.ChannelID || parent.AuthorID != botID || !parent.AuthorIsBot {
				return s.holdUnknownDestination(ctx, taskID, executor)
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := gateway.EditMessage(ctx, state.job.ChannelID, state.parentID, RenderReminderNoticeParent()); err != nil {
				return s.threadReadFailure(ctx, taskID, executor, err)
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := gateway.PinMessage(ctx, state.job.ChannelID, state.parentID); err != nil {
			return s.threadReadFailure(ctx, taskID, executor, err)
		}
	}
	if state.threadID != "" {
		if err := ctx.Err(); err != nil {
			return err
		}
		thread, err := gateway.GetThread(ctx, state.threadID)
		if err != nil {
			return s.threadReadFailure(ctx, taskID, executor, err)
		}
		if thread.ID != state.threadID || thread.ParentID != state.job.ChannelID {
			return s.holdUnknownDestination(ctx, taskID, executor)
		}
		if thread.Archived {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := gateway.UnarchiveThread(ctx, thread.ID); err != nil {
				return s.threadReadFailure(ctx, taskID, executor, err)
			}
		}
		return s.completeKnownOutput(ctx, taskID, executor)
	}
	dispatch, err := s.BeginOutputDispatch(ctx, taskID, executor, "thread", state.job.ChannelID, true)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	name := "操作ログ"
	if reminder {
		name = "通知用スレッド"
	}
	thread, err := gateway.CreateThread(ctx, state.job.ChannelID, state.parentID, name)
	if err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, err)
	}
	if thread.ParentID != state.job.ChannelID || thread.OwnerID != botID || !discordID.MatchString(thread.ID) {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	if err := s.CompleteOutputDispatch(ctx, taskID, executor, "thread", dispatch.ID, thread.ID, true); err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	return nil
}

func (s *Service) threadReadFailure(ctx context.Context, taskID, executor string, err error) error {
	var failure *DiscordFailure
	if errors.As(err, &failure) && (failure.Kind == DiscordUnknownMessage || failure.Kind == DiscordUnknownChannel) {
		return s.holdUnknownDestination(ctx, taskID, executor)
	}
	return s.FailOutput(ctx, taskID, executor, "", err)
}

func (s *Service) holdUnknownDestination(ctx context.Context, taskID, executor string) error {
	return s.store.Write(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, true)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		job.State, job.Executor, job.LastError, job.UpdatedAt = OutputUncertain, "", "既存通知先の所在不明", s.now()
		return r.PutOutput(ctx, *job)
	})
}
