package application

import (
	"context"
	"strconv"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// RequestDeleteAll freezes the snowflake boundary and suspends output in the
// same commit. It does not fetch Discord while holding database locks.
func (s *Service) RequestDeleteAll(ctx context.Context, channel string) (*OutputTask, error) {
	actor, ok := OutputOperationFromContext(ctx)
	if !ok || !discordID.MatchString(actor.ActorID) || !discordID.MatchString(channel) {
		return nil, domain.Fail(domain.CodeInvalidInput, "actor", "A valid actor and channel are required")
	}
	return write(s, ctx, func(r Repository) (*OutputTask, error) {
		if err := r.LockOutputQueue(ctx); err != nil {
			return nil, err
		}
		jobs, err := r.ListOutputs(ctx, OutputFilter{ChannelID: channel})
		if err != nil {
			return nil, err
		}
		for _, job := range jobs {
			if job.Kind != OutputDeleteAll {
				continue
			}
			if !outputTerminal(job.State) {
				return &job, nil
			}
			if actor.InteractionID != "" && job.OperationID != "" {
				op, err := r.GetOperation(ctx, job.OperationID)
				if err != nil {
					return nil, err
				}
				if op != nil && op.InteractionID == actor.InteractionID {
					return &job, nil
				}
			}
		}
		now := s.now()
		// Discord IDs reserve the lower 22 bits for worker/process/sequence.
		// before is exclusive and starts immediately after this millisecond.
		elapsed := now.UnixMilli() - 1420070400000
		if elapsed < 0 || elapsed >= 1<<42-1 {
			return nil, domain.Fail(domain.CodeInvalidInput, "time", "Timestamp cannot be represented as a Discord ID")
		}
		before := uint64(elapsed+1) << 22
		operationID, err := s.reserveBusinessOperation(ctx, r, channel, nil, OperationFacts{})
		if err != nil {
			return nil, err
		}
		if actor.InteractionID != "" && operationID == "" {
			return nil, domain.Fail(domain.CodeConflict, actor.InteractionID, "Interaction already recorded for another operation")
		}
		id, err := s.ids.NewID()
		if err != nil {
			return nil, err
		}
		job := OutputTask{ID: id, ChannelID: channel, Kind: OutputDeleteAll, TargetID: channel, OperationID: operationID, DestinationKey: "delete_all:" + channel, State: OutputPending, CreatedAt: now, UpdatedAt: now, AvailableAt: now, Payload: OutputPayload{Deletion: &DeleteProgress{UpperID: strconv.FormatUint(before-1, 10), BeforeID: strconv.FormatUint(before, 10), FetchedIDs: []string{}, ConfirmedIDs: []string{}, RemainingIDs: []string{}}}}
		if err := r.PutSuspension(ctx, OutputSuspension{ChannelID: channel, SuspendedBy: actor.ActorID, SuspendedAt: now}); err != nil {
			return nil, err
		}
		if _, err := r.EnqueueOutput(ctx, job); err != nil {
			return nil, err
		}
		return &job, nil
	})
}
