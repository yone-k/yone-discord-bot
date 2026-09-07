package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type cardSnapshot struct {
	job              OutputTask
	message          DisplayMessage
	messageID        string
	missing          bool
	restoreSelection bool
}

func (s *Service) cardSnapshot(ctx context.Context, taskID, executor string) (*cardSnapshot, error) {
	return read(s, ctx, func(r Repository) (*cardSnapshot, error) {
		job, err := r.GetOutput(ctx, taskID, false)
		if err != nil {
			return nil, err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return nil, domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		out := &cardSnapshot{job: *job}
		// An explicit cleanup retains the old Discord ID independently of a
		// replacement business row or a newer card for the same target.
		if job.Payload.MessageID != "" {
			out.missing = true
			return out, nil
		}
		switch job.Kind {
		case OutputListRender:
			list, err := r.GetList(ctx, job.ChannelID, false)
			if err != nil {
				return nil, err
			}
			if list == nil {
				out.missing = true
				break
			}
			if list.Channel.MessageID != nil {
				out.messageID = *list.Channel.MessageID
			}
			out.message, err = RenderListCard(*list, s.now())
			if err != nil {
				return nil, err
			}
		case OutputInventoryRender:
			catalog, err := r.GetCatalog(ctx, job.ChannelID, false)
			if err != nil {
				return nil, err
			}
			if catalog == nil {
				out.missing = true
				break
			}
			if catalog.Channel.MessageID != nil {
				out.messageID = *catalog.Channel.MessageID
			}
			mode, page := CardNormal, 0
			view, err := r.GetCardView(ctx, job.ChannelID, CardInventory, job.TargetID)
			if err != nil {
				return nil, err
			}
			if view != nil {
				mode, page = view.Mode, view.Page
			}
			out.message, err = RenderInventoryCard(*catalog, mode, page, s.now())
			if err != nil {
				return nil, err
			}
		case OutputTaskCard:
			task, err := r.GetTask(ctx, job.ChannelID, job.TargetID, false)
			if err != nil {
				return nil, err
			}
			if task == nil {
				out.missing = true
				break
			}
			channel, err := getRemind(ctx, r, job.ChannelID, false)
			if err != nil {
				return nil, err
			}
			var catalog *domain.InventoryCatalog
			if channel.LinkedInventoryChannelID != nil && len(task.InventoryItems) > 0 {
				catalog, err = getCatalog(ctx, r, *channel.LinkedInventoryChannelID, false)
				if err != nil {
					return nil, err
				}
			}
			if task.MessageID != nil {
				out.messageID = *task.MessageID
			}
			mode := CardNormal
			view, err := r.GetCardView(ctx, job.ChannelID, CardTask, job.TargetID)
			if err != nil {
				return nil, err
			}
			if view != nil {
				mode = view.Mode
			}
			// Selection custom IDs contain the Discord message ID. Create the
			// normal card first, then render selection using the confirmed ID.
			if mode == CardUpdateSelection && out.messageID == "" {
				mode, out.restoreSelection = CardNormal, true
			}
			out.message, err = RenderTaskCard(*task, catalog, mode, s.now())
			if err != nil {
				return nil, err
			}
		default:
			return nil, domain.Fail(domain.CodeInvalidInput, taskID, "Not a card output")
		}
		return out, nil
	})
}

// ExecuteCard uses a leadership lease context and never retains a transaction
// across Discord I/O. New cards use the same durable dispatch protocol as logs.
func (s *Service) ExecuteCard(ctx context.Context, gateway DiscordGateway, botID, taskID, executor string) error {
	card, err := s.cardSnapshot(ctx, taskID, executor)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if card.missing {
		if card.job.Payload.MessageID != "" {
			if err := gateway.DeleteMessage(ctx, card.job.ChannelID, card.job.Payload.MessageID); err != nil && !unknownDiscordMessage(err) {
				return s.FailOutput(ctx, taskID, executor, "", err)
			}
		}
		return s.completeKnownOutput(ctx, taskID, executor)
	}
	if card.messageID != "" {
		if err := gateway.EditMessage(ctx, card.job.ChannelID, card.messageID, card.message); err != nil {
			if unknownDiscordMessage(err) {
				if clearErr := s.clearMissingCardID(ctx, card.job, executor, card.messageID); clearErr != nil {
					return clearErr
				}
			}
			return s.FailOutput(ctx, taskID, executor, "", err)
		}
		if card.job.Payload.PinMessage {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := gateway.PinMessage(ctx, card.job.ChannelID, card.messageID); err != nil {
				if unknownDiscordMessage(err) {
					if err := s.clearMissingCardID(ctx, card.job, executor, card.messageID); err != nil {
						return err
					}
				}
				return s.FailOutput(ctx, taskID, executor, "", err)
			}
		}
		return s.completeKnownOutput(ctx, taskID, executor)
	}
	if !discordID.MatchString(botID) {
		return s.FailOutput(ctx, taskID, executor, "", &DiscordFailure{Kind: DiscordRejected})
	}
	stageName := "message"
	if len(card.job.Payload.Stages) > 0 {
		last := card.job.Payload.Stages[len(card.job.Payload.Stages)-1]
		stageName = last.Name
		if last.Done {
			stageName = fmt.Sprintf("message:%d", len(card.job.Payload.Stages))
		}
	}
	dispatch, err := s.BeginOutputDispatch(ctx, taskID, executor, stageName, card.job.ChannelID, false)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	message, err := gateway.CreateMessage(ctx, card.job.ChannelID, card.message, dispatch.Nonce)
	if err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, err)
	}
	if message.ChannelID != card.job.ChannelID || message.AuthorID != botID || !message.AuthorIsBot || !discordID.MatchString(message.ID) || message.Nonce != "" && message.Nonce != dispatch.Nonce {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	if err := s.CompleteOutputDispatch(ctx, taskID, executor, stageName, dispatch.ID, message.ID, !card.restoreSelection && !card.job.Payload.PinMessage); err != nil {
		return s.FailOutput(ctx, taskID, executor, dispatch.ID, &DiscordFailure{Kind: DiscordIndeterminate})
	}
	if card.restoreSelection || card.job.Payload.PinMessage {
		return s.ExecuteCard(ctx, gateway, botID, taskID, executor)
	}
	return nil
}

func (s *Service) clearMissingCardID(ctx context.Context, job OutputTask, executor, missingID string) error {
	return s.store.Write(ctx, func(r Repository) error {
		// Business parent locks precede the outbox lock, as in normal mutations.
		switch job.Kind {
		case OutputListRender:
			list, err := r.GetList(ctx, job.ChannelID, true)
			if err != nil {
				return err
			}
			if list != nil && list.Channel.MessageID != nil && *list.Channel.MessageID == missingID {
				list.Channel.MessageID = nil
				if err := r.PutList(ctx, list); err != nil {
					return err
				}
			}
		case OutputInventoryRender:
			catalog, err := r.GetCatalog(ctx, job.ChannelID, true)
			if err != nil {
				return err
			}
			if catalog != nil && catalog.Channel.MessageID != nil && *catalog.Channel.MessageID == missingID {
				catalog.Channel.MessageID = nil
				if err := r.PutCatalog(ctx, catalog); err != nil {
					return err
				}
			}
		case OutputTaskCard:
			channel, err := r.GetRemindChannel(ctx, job.ChannelID, true)
			if err != nil {
				return err
			}
			if channel != nil {
				task, err := r.GetTask(ctx, job.ChannelID, job.TargetID, true)
				if err != nil {
					return err
				}
				if task != nil && task.MessageID != nil && *task.MessageID == missingID {
					task.MessageID = nil
					if err := r.PutTask(ctx, task, channel.LinkedInventoryChannelID, false); err != nil {
						return err
					}
				}
			}
		}
		current, err := r.GetOutput(ctx, job.ID, true)
		if err != nil {
			return err
		}
		if current == nil || current.State != OutputRunning || current.Executor != executor {
			return domain.Fail(domain.CodeConflict, job.ID, "Output execution ownership changed")
		}
		return nil
	})
}

func unknownDiscordMessage(err error) bool {
	var failure *DiscordFailure
	return errors.As(err, &failure) && failure.Kind == DiscordUnknownMessage
}

func (s *Service) completeKnownOutput(ctx context.Context, taskID, executor string) error {
	return s.store.Write(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, true)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		history, err := r.OutputDispatches(ctx, taskID)
		if err != nil {
			return err
		}
		for _, dispatch := range history {
			if dispatch.Outcome == DispatchUnknown {
				return domain.Fail(domain.CodeConflict, taskID, "A create result remains unknown")
			}
		}
		job.State, job.Executor, job.LastError, job.UpdatedAt = OutputSucceeded, "", "", s.now()
		return r.PutOutput(ctx, *job)
	})
}
