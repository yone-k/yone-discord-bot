package application

import (
	"context"
	"encoding/base64"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

const deleteAwaitingCreation = "先行投稿の結果確認待ち"

func outputTerminal(state OutputState) bool {
	return state == OutputSucceeded || state == OutputCancelled
}
func outputCard(kind OutputKind) bool {
	return kind == OutputListRender || kind == OutputInventoryRender || kind == OutputTaskCard
}

// ClaimOutput assigns one task while retaining channel serialization and
// destination ordering. A held destination does not prevent unrelated output.
func (s *Service) ClaimOutput(ctx context.Context, executor string) (*OutputTask, error) {
	if executor == "" {
		return nil, errors.New("output executor is required")
	}
	return write(s, ctx, func(r Repository) (*OutputTask, error) {
		if err := r.LockOutputQueue(ctx); err != nil {
			return nil, err
		}
		now := s.now()
		var after int64
		for {
			jobs, err := r.ListOutputs(ctx, OutputFilter{ClaimableAt: &now, AfterOrder: after, Limit: 1})
			if err != nil {
				return nil, err
			}
			if len(jobs) == 0 {
				return nil, nil
			}
			job := jobs[0]
			after = job.Order
			if job.Payload.DependencyTaskID != "" && job.Kind != OutputDeleteAll {
				dependency, err := r.GetOutput(ctx, job.Payload.DependencyTaskID, false)
				if err != nil {
					return nil, err
				}
				if dependency == nil || dependency.ChannelID != job.ChannelID || dependency.State != OutputSucceeded {
					continue
				}
			}
			stop, err := r.GetSuspension(ctx, job.ChannelID)
			if err != nil {
				return nil, err
			}
			if stop != nil && job.Kind != OutputDeleteAll {
				continue
			}
			if job.Kind == OutputDeleteAll {
				dependencyID, err := r.PriorUnresolvedCreation(ctx, job.ChannelID, job.Order)
				if err != nil {
					return nil, err
				}
				job.Payload.DependencyTaskID = dependencyID
				if dependencyID != "" {
					if job.Payload.Deletion == nil {
						return nil, domain.Fail(domain.CodeInvalidInput, job.ID, "Missing deletion progress")
					}
					job.Payload.Deletion.FirstAttemptFinished = true
					job.State, job.LastError, job.UpdatedAt = OutputRetryWait, deleteAwaitingCreation, s.now()
					job.AvailableAt = s.now().Add(time.Second)
					if err := r.PutOutput(ctx, job); err != nil {
						return nil, err
					}
					continue
				}
			}
			job.State, job.Executor, job.UpdatedAt = OutputRunning, executor, s.now()
			if err := r.PutOutput(ctx, job); err != nil {
				return nil, err
			}
			return &job, nil
		}
	})
}

// BeginOutputDispatch must return successfully before the HTTP create starts.
// A dispatch is an individual attempt; its logical stage retains the first UUID
// for its nonce. Thread creation deliberately has no nonce.
func (s *Service) BeginOutputDispatch(ctx context.Context, taskID, executor, stageName, destination string, thread bool) (*OutputDispatch, error) {
	return write(s, ctx, func(r Repository) (*OutputDispatch, error) {
		job, err := r.GetOutput(ctx, taskID, true)
		if err != nil {
			return nil, err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return nil, domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		if stageName == "" || destination == "" {
			return nil, domain.Fail(domain.CodeInvalidInput, taskID, "Output stage and destination are required")
		}
		history, err := r.OutputDispatches(ctx, taskID)
		if err != nil {
			return nil, err
		}
		for _, d := range history {
			if d.Outcome == DispatchUnknown {
				return nil, domain.Fail(domain.CodeConflict, taskID, "A create result remains unknown")
			}
		}
		held, err := r.HasUnresolvedDestinationCreation(ctx, job.ChannelID, job.DestinationKey)
		if err != nil {
			return nil, err
		}
		if held {
			return nil, domain.Fail(domain.CodeConflict, taskID, "Destination has an unresolved creation")
		}
		index := -1
		for i, stage := range job.Payload.Stages {
			if stage.Name == stageName {
				index = i
				break
			}
		}
		if index < 0 {
			job.Payload.Stages = append(job.Payload.Stages, OutputStage{Name: stageName, DestinationID: destination})
			index = len(job.Payload.Stages) - 1
		}
		stage := &job.Payload.Stages[index]
		if stage.Done || stage.DestinationID != destination {
			return nil, domain.Fail(domain.CodeConflict, taskID, "Output stage already completed or destination changed")
		}
		id, err := s.ids.NewID()
		if err != nil {
			return nil, err
		}
		if stage.FirstDispatchID == "" {
			stage.FirstDispatchID = id
		}
		nonce := ""
		if !thread {
			first, err := uuid.Parse(stage.FirstDispatchID)
			if err != nil {
				return nil, err
			}
			nonce = base64.RawURLEncoding.EncodeToString(first[:])
		}
		attempt := 1
		for _, d := range history {
			if d.Attempt >= attempt {
				attempt = d.Attempt + 1
			}
		}
		dispatch := OutputDispatch{ID: id, TaskID: taskID, Nonce: nonce, Attempt: attempt, StartedAt: s.now(), Outcome: DispatchUnknown}
		stage.CurrentDispatchID = id
		if err := r.PutDispatch(ctx, dispatch); err != nil {
			return nil, err
		}
		job.UpdatedAt = s.now()
		if err := r.PutOutput(ctx, *job); err != nil {
			return nil, err
		}
		return &dispatch, nil
	})
}

// RecoverRunningOutputs runs after leadership acquisition, before any send. A
// recorded unknown create never becomes pending merely because the process died.
func (s *Service) RecoverRunningOutputs(ctx context.Context) error {
	return s.store.Write(ctx, func(r Repository) error {
		if err := r.LockOutputQueue(ctx); err != nil {
			return err
		}
		jobs, err := r.ListOutputs(ctx, OutputFilter{States: []OutputState{OutputRunning, OutputPending}})
		if err != nil {
			return err
		}
		for i := range jobs {
			job := &jobs[i]
			if job.State != OutputRunning {
				continue
			}
			dispatches, err := r.OutputDispatches(ctx, job.ID)
			if err != nil {
				return err
			}
			unknown := false
			for _, d := range dispatches {
				if d.Outcome == DispatchUnknown {
					unknown = true
					break
				}
			}
			job.Executor = ""
			job.UpdatedAt = s.now()
			if unknown {
				job.State, job.LastError = OutputUncertain, "Create result was not committed before execution stopped"
			} else {
				// Free the partial unique key before recovering the running card.
				// The original stage/dispatch evidence stays on the original job.
				if outputCard(job.Kind) && job.Payload.MessageID == "" {
					for j := range jobs {
						next := &jobs[j]
						if next.ID == job.ID || next.State != OutputPending || next.ChannelID != job.ChannelID || next.Kind != job.Kind || next.TargetID != job.TargetID || next.Payload.MessageID != "" {
							continue
						}
						job.Payload.PinMessage = job.Payload.PinMessage || next.Payload.PinMessage
						next.State, next.UpdatedAt = OutputCancelled, s.now()
						next.LastError = "Merged into recovered card output"
						if err := r.PutOutput(ctx, *next); err != nil {
							return err
						}
					}
				}
				job.State, job.AvailableAt, job.LastError = OutputPending, s.now(), ""
			}
			if err := r.PutOutput(ctx, *job); err != nil {
				return err
			}
		}
		return nil
	})
}

// FailOutput commits the attempt classification. Missing dispatchID means an
// operation on a known ID, which can be retried without creating a duplicate.
func (s *Service) FailOutput(ctx context.Context, taskID, executor, dispatchID string, cause error) error {
	if cause == nil {
		return errors.New("output failure requires a cause")
	}
	return s.store.Write(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, true)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		var discordFailure *DiscordFailure
		typed := errors.As(cause, &discordFailure)
		job.State = OutputRetryWait
		job.LastError = "Discord output did not complete"
		if typed {
			job.LastError = discordFailure.Error()
		}
		if typed && discordFailure.Kind == DiscordRateLimited {
			delay := discordFailure.RetryAfter
			if delay <= 0 {
				delay = time.Second
			}
			job.AvailableAt = s.now().Add(delay)
		} else {
			job.Attempts++
			delay := 60 * time.Second
			if job.Attempts <= 6 {
				delay = time.Second * time.Duration(1<<uint(job.Attempts-1))
			}
			job.AvailableAt = s.now().Add(delay)
			if typed && (discordFailure.Kind == DiscordRejected || discordFailure.Kind == DiscordUnknownChannel) {
				job.State = OutputBlocked
			}
			if dispatchID != "" && (!typed || discordFailure.Kind == DiscordIndeterminate) {
				job.State = OutputUncertain
			}
		}
		if dispatchID != "" {
			history, err := r.OutputDispatches(ctx, taskID)
			if err != nil {
				return err
			}
			found := false
			for _, d := range history {
				if d.ID != dispatchID {
					continue
				}
				if d.Outcome != DispatchUnknown {
					return domain.Fail(domain.CodeConflict, dispatchID, "Dispatch already completed")
				}
				found = true
				now := s.now()
				d.FinishedAt = &now
				if job.State != OutputUncertain {
					d.Outcome = DispatchFailed
				}
				if err := r.PutDispatch(ctx, d); err != nil {
					return err
				}
			}
			if !found {
				return domain.Fail(domain.CodeNotFound, dispatchID, "Dispatch does not exist")
			}
		}
		job.Executor, job.UpdatedAt = "", s.now()
		if job.Kind == OutputDeleteAll && job.Payload.Deletion != nil {
			job.Payload.Deletion.FirstAttemptFinished = true
		}
		return r.PutOutput(ctx, *job)
	})
}
