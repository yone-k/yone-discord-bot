package application

import (
	"context"

	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type OutputDetails struct {
	Task       OutputTask
	Dispatches []OutputDispatch
	Operation  *OperationRecord
}

func (s *Service) ListOutputJobs(ctx context.Context, filter OutputFilter) ([]OutputTask, error) {
	if filter.Limit < 0 || filter.Limit > 1000 {
		return nil, domain.Fail(domain.CodeInvalidInput, "limit", "Limit must be between 0 and 1000")
	}
	if filter.Limit == 0 {
		filter.Limit = 100
	}
	for _, state := range filter.States {
		switch state {
		case OutputPending, OutputRunning, OutputRetryWait, OutputUncertain, OutputBlocked, OutputSucceeded, OutputCancelled:
		default:
			return nil, domain.Fail(domain.CodeInvalidInput, "state", "Invalid output state")
		}
	}
	return read(s, ctx, func(r Repository) ([]OutputTask, error) { return r.ListOutputs(ctx, filter) })
}

func (s *Service) GetOutputDetails(ctx context.Context, id string) (*OutputDetails, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.Fail(domain.CodeInvalidInput, "jobId", "Invalid output job ID")
	}
	return read(s, ctx, func(r Repository) (*OutputDetails, error) {
		job, err := r.GetOutput(ctx, parsed.String(), false)
		if err != nil {
			return nil, err
		}
		if job == nil {
			return nil, domain.Fail(domain.CodeNotFound, id, "Output job not found")
		}
		history, err := r.OutputDispatches(ctx, job.ID)
		if err != nil {
			return nil, err
		}
		result := &OutputDetails{Task: *job, Dispatches: history}
		if job.OperationID != "" {
			result.Operation, err = r.GetOperation(ctx, job.OperationID)
		}
		return result, err
	})
}

func (s *Service) CancelOutput(ctx context.Context, id string) error {
	return s.controlOutput(ctx, id, "cancel", func(r Repository, job *OutputTask) error {
		if outputTerminal(job.State) {
			return domain.Fail(domain.CodeConflict, id, "Output is already finished")
		}
		history, err := r.OutputDispatches(ctx, job.ID)
		if err != nil {
			return err
		}
		job.Payload.HoldCreation = job.State == OutputUncertain
		for _, dispatch := range history {
			if dispatch.Outcome == DispatchUnknown {
				job.Payload.HoldCreation = true
			}
		}
		job.State, job.Executor, job.LastError = OutputCancelled, "", "運用者による取消"
		if job.Payload.HoldCreation {
			job.LastError = "取消済み・作成結果未確認"
		}
		if job.Payload.Deletion != nil {
			job.Payload.Deletion.FirstAttemptFinished = true
		}
		return nil
	})
}

func (s *Service) RetryOutputConfirmedUnsent(ctx context.Context, id string, confirmed bool) error {
	if !confirmed {
		return domain.Fail(domain.CodeInvalidInput, "confirmation", "Explicit unsent confirmation is required")
	}
	return s.controlOutput(ctx, id, "retry-confirm-unsent", func(r Repository, job *OutputTask) error {
		if job.State == OutputSucceeded || job.State == OutputPending {
			return domain.Fail(domain.CodeConflict, id, "Output is not awaiting intervention")
		}
		history, err := r.OutputDispatches(ctx, job.ID)
		if err != nil {
			return err
		}
		for _, dispatch := range history {
			if dispatch.Outcome != DispatchUnknown {
				continue
			}
			now := s.now()
			dispatch.Outcome, dispatch.FinishedAt = DispatchFailed, &now
			if err := r.PutDispatch(ctx, dispatch); err != nil {
				return err
			}
		}
		job.Payload.HoldCreation = false
		if job.Kind == OutputThreadEnsure {
			job.Payload.AllowCreate = true
		}
		// retry_wait avoids colliding with an already pending card successor.
		job.State, job.Executor, job.LastError, job.AvailableAt = OutputRetryWait, "", "", s.now()
		return nil
	})
}

func (s *Service) controlOutput(ctx context.Context, id, action string, change func(Repository, *OutputTask) error) error {
	actor, ok := OutputOperationFromContext(ctx)
	if !ok || actor.Kind != "outputctl" || !discordID.MatchString(actor.ActorID) {
		return domain.Fail(domain.CodeInvalidInput, "actor", "An outputctl operator is required")
	}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return domain.Fail(domain.CodeInvalidInput, "jobId", "Invalid output job ID")
	}
	return s.store.Write(ctx, func(r Repository) error {
		if err := r.LockOutputQueue(ctx); err != nil {
			return err
		}
		job, err := r.GetOutput(ctx, parsed.String(), true)
		if err != nil {
			return err
		}
		if job == nil {
			return domain.Fail(domain.CodeNotFound, id, "Output job not found")
		}
		if job.State == OutputRunning {
			return domain.Fail(domain.CodeConflict, id, "Output is running")
		}
		if err := change(r, job); err != nil {
			return err
		}
		auditID, err := s.ids.NewID()
		if err != nil {
			return err
		}
		now := s.now()
		inserted, err := r.PutOperation(ctx, OperationRecord{ID: auditID, ChannelID: job.ChannelID, ActorID: actor.ActorID, Kind: "outputctl", Success: true, OccurredAt: now, Facts: OperationFacts{Message: action + " " + job.ID}})
		if err != nil {
			return err
		}
		if !inserted {
			return domain.Fail(domain.CodeConflict, auditID, "Output audit was not recorded")
		}
		job.UpdatedAt = now
		return r.PutOutput(ctx, *job)
	})
}
