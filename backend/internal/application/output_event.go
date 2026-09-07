package application

import (
	"context"
	"strings"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type OutputLogEvent struct {
	ActorID, ChannelID, InteractionID string
	OperationKind                     OperationKind
	OccurredAt                        time.Time
	Success                           bool
	Message, CancelReason             string
}

// UI events describe outcomes that never reached a business mutation. The
// interaction key also prevents a late UI report duplicating a committed
// business operation. API response loss must not be reported as a UI failure.
func (s *Service) RecordOutputEvent(ctx context.Context, event OutputLogEvent) ([]string, error) {
	actor, ok := OutputOperationFromContext(ctx)
	if !ok || actor.ActorID != event.ActorID || actor.Kind != event.OperationKind || actor.InteractionID != event.InteractionID {
		return nil, domain.Fail(domain.CodeInvalidInput, "actor", "Event actor does not match request context")
	}
	if !discordID.MatchString(event.ActorID) || !discordID.MatchString(event.ChannelID) || !discordID.MatchString(event.InteractionID) || event.OccurredAt.IsZero() || event.OccurredAt.Year() < 1 || event.OccurredAt.Year() > 9999 {
		return nil, domain.Fail(domain.CodeInvalidInput, "event", "Invalid event identity or timestamp")
	}
	return s.recordOutputOutcome(ctx, event)
}

func (s *Service) recordOutputOutcome(ctx context.Context, event OutputLogEvent) ([]string, error) {
	info, ok := DescribeOutputOperation(event.OperationKind)
	if !ok {
		return nil, domain.Fail(domain.CodeInvalidInput, "kind", "Unknown output operation")
	}
	return write(s, ctx, func(r Repository) ([]string, error) {
		var threadID *string
		if info.PostLog {
			if strings.HasPrefix(string(event.OperationKind), "Remind") {
				ch, err := r.GetRemindChannel(ctx, event.ChannelID, true)
				if err != nil {
					return nil, err
				}
				if ch != nil {
					threadID = ch.OperationLogThreadID
				}
			} else {
				list, err := r.GetList(ctx, event.ChannelID, true)
				if err != nil {
					return nil, err
				}
				if list != nil {
					threadID = list.Channel.OperationLogThreadID
				}
			}
		}
		id, err := s.ids.NewID()
		if err != nil {
			return nil, err
		}
		inserted, err := r.PutOperation(ctx, OperationRecord{ID: id, ChannelID: event.ChannelID, ActorID: event.ActorID, Kind: event.OperationKind, InteractionID: event.InteractionID, Success: event.Success, OccurredAt: event.OccurredAt, Facts: OperationFacts{Message: event.Message, CancelReason: event.CancelReason}})
		if err != nil {
			return nil, err
		}
		if !inserted || !info.PostLog || threadID == nil {
			return []string{}, nil
		}
		taskID, err := s.ids.NewID()
		if err != nil {
			return nil, err
		}
		now := s.now()
		if _, err := r.EnqueueOutput(ctx, OutputTask{ID: taskID, ChannelID: event.ChannelID, Kind: OutputOperationLog, TargetID: id, OperationID: id, DestinationKey: "operation_log:" + *threadID, State: OutputPending, AvailableAt: now, CreatedAt: now, UpdatedAt: now, Payload: OutputPayload{DestinationID: *threadID}}); err != nil {
			return nil, err
		}
		return []string{taskID}, nil
	})
}
