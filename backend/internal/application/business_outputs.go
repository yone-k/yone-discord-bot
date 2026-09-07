package application

import (
	"context"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// reserveBusinessOutput is called inside the business write transaction. A
// background mutation has no invented actor, but still reserves its rendering.
func (s *Service) reserveBusinessOutput(ctx context.Context, r Repository, channel, target string, kind OutputKind, threadID *string, facts OperationFacts, payload OutputPayload) error {
	operationID, err := s.reserveBusinessOperation(ctx, r, channel, threadID, facts)
	if err != nil {
		return err
	}
	return s.reserveCardOutput(ctx, r, channel, target, kind, operationID, payload)
}

func (s *Service) reserveBusinessOperation(ctx context.Context, r Repository, channel string, threadID *string, facts OperationFacts) (string, error) {
	now := s.now()
	operationID := ""
	if actor, ok := OutputOperationFromContext(ctx); ok && !actor.auxiliary {
		id, err := s.ids.NewID()
		if err != nil {
			return "", err
		}
		op := OperationRecord{ID: id, ChannelID: channel, ActorID: actor.ActorID, Kind: actor.Kind, InteractionID: actor.InteractionID, Success: true, OccurredAt: now, Facts: facts}
		inserted, err := r.PutOperation(ctx, op)
		if err != nil {
			return "", err
		}
		if inserted {
			operationID = id
			info, _ := DescribeOutputOperation(actor.Kind)
			if info.PostLog && threadID != nil {
				logID, err := s.ids.NewID()
				if err != nil {
					return "", err
				}
				_, err = r.EnqueueOutput(ctx, OutputTask{ID: logID, ChannelID: channel, Kind: OutputOperationLog, TargetID: id, OperationID: id, DestinationKey: "operation_log:" + *threadID, State: OutputPending, AvailableAt: now, CreatedAt: now, UpdatedAt: now, Payload: OutputPayload{DestinationID: *threadID}})
				if err != nil {
					return "", err
				}
			}
		}
	}
	return operationID, nil
}

func (s *Service) reserveCardOutput(ctx context.Context, r Repository, channel, target string, kind OutputKind, operationID string, payload OutputPayload) error {
	now := s.now()
	id, err := s.ids.NewID()
	if err != nil {
		return err
	}
	_, err = r.EnqueueOutput(ctx, OutputTask{ID: id, ChannelID: channel, Kind: kind, TargetID: target, OperationID: operationID, DestinationKey: string(kind) + ":" + target, State: OutputPending, AvailableAt: now, CreatedAt: now, UpdatedAt: now, Payload: payload})
	return err
}

func (s *Service) reserveRelatedTaskCards(ctx context.Context, r Repository, inventoryChannel string) error {
	_, tasks, err := references(ctx, r, inventoryChannel)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		if err := s.reserveCardOutput(ctx, r, task.ChannelID, task.ID, OutputTaskCard, "", OutputPayload{}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reserveReminderCards(ctx context.Context, r Repository, ch *domain.RemindChannelSettings) error {
	operationID, err := s.reserveBusinessOperation(ctx, r, ch.ChannelID, ch.OperationLogThreadID, OperationFacts{})
	if err != nil {
		return err
	}
	tasks, err := r.Tasks(ctx, ch.ChannelID, false)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		if err := s.reserveCardOutput(ctx, r, ch.ChannelID, task.ID, OutputTaskCard, operationID, OutputPayload{}); err != nil {
			return err
		}
	}
	return nil
}

func listOperationFacts(before, after []domain.ListItem) (OperationFacts, error) {
	facts := OperationFacts{}
	previous, next := map[string]domain.ListItem{}, map[string]domain.ListItem{}
	for _, item := range before {
		previous[item.Name] = item
	}
	for _, item := range after {
		next[item.Name] = item
	}
	for _, item := range after {
		display, err := listLogItem(item)
		if err != nil {
			return facts, err
		}
		old, ok := previous[item.Name]
		if !ok {
			facts.Added = append(facts.Added, display)
			continue
		}
		if !equalOptionalText(old.Category, item.Category) || !equalOptionalText(old.Until, item.Until) || old.IsCompleted != item.IsCompleted {
			oldDisplay, err := listLogItem(old)
			if err != nil {
				return facts, err
			}
			facts.Modified = append(facts.Modified, LogItemChange{Name: item.Name, Before: oldDisplay, After: display, CheckPresent: true, CategoryPresent: true, UntilPresent: true})
		}
	}
	for _, item := range before {
		if _, ok := next[item.Name]; !ok {
			display, err := listLogItem(item)
			if err != nil {
				return facts, err
			}
			facts.Removed = append(facts.Removed, display)
		}
	}
	return facts, nil
}
func equalOptionalText(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
func listLogItem(item domain.ListItem) (LogItem, error) {
	result := LogItem{Name: item.Name, Check: item.IsCompleted}
	if item.Category != nil {
		result.Category = *item.Category
	}
	if item.Until != nil {
		date, err := time.ParseInLocation("2006-01-02", *item.Until, domain.Tokyo)
		if err != nil {
			return result, err
		}
		result.Until = &date
	}
	return result, nil
}
