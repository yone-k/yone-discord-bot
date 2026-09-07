package application

import (
	"context"
	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"time"
)

func (s *Service) GetOutputJob(ctx context.Context, id string) (*OutputTask, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.Fail(domain.CodeInvalidInput, "jobId", "Invalid output job ID")
	}
	return read(s, ctx, func(r Repository) (*OutputTask, error) {
		job, err := r.GetOutput(ctx, parsed.String(), false)
		return required(job, err, id)
	})
}

type OutputHold struct {
	TaskID, ChannelID, Reason, DependencyTaskID string
	Kind                                        OutputKind
	State                                       OutputState
}

type OutputStateCount struct {
	State OutputState
	Count int
}

type OutputStatus struct {
	Contract               string
	Enabled, WorkerRunning bool
	Counts                 []OutputStateCount
	OldestPendingAt        *time.Time
	Suspensions            []OutputSuspension
	Holds                  []OutputHold
}

// Runtime supplies enabled/workerRunning; queue state comes from one DB
// snapshot. Readiness does not depend on the queue being empty or unblocked.
func (s *Service) GetOutputStatus(ctx context.Context, enabled, workerRunning bool) (*OutputStatus, error) {
	return read(s, ctx, func(r Repository) (*OutputStatus, error) {
		status := &OutputStatus{Contract: OutputContract, Enabled: enabled, WorkerRunning: workerRunning, Counts: []OutputStateCount{}, Holds: []OutputHold{}}
		jobs, err := r.ListOutputs(ctx, OutputFilter{ActiveOnly: true})
		if err != nil {
			return nil, err
		}
		status.Suspensions, err = r.ListSuspensions(ctx)
		if err != nil {
			return nil, err
		}
		byID := make(map[string]OutputTask, len(jobs))
		counts, err := r.OutputCounts(ctx)
		if err != nil {
			return nil, err
		}
		for _, job := range jobs {
			byID[job.ID] = job
			if !outputTerminal(job.State) || job.Payload.HoldCreation {
				if status.OldestPendingAt == nil || job.CreatedAt.Before(*status.OldestPendingAt) {
					created := job.CreatedAt
					status.OldestPendingAt = &created
				}
			}
		}
		for _, state := range []OutputState{OutputPending, OutputRunning, OutputRetryWait, OutputUncertain, OutputBlocked, OutputSucceeded, OutputCancelled} {
			status.Counts = append(status.Counts, OutputStateCount{State: state, Count: counts[state]})
		}
		for _, job := range jobs {
			if outputTerminal(job.State) && !job.Payload.HoldCreation {
				continue
			}
			hold := OutputHold{TaskID: job.ID, ChannelID: job.ChannelID, Kind: job.Kind, State: job.State, Reason: job.LastError}
			if id := job.Payload.DependencyTaskID; id != "" {
				dependency, exists := byID[id]
				if !exists {
					stored, err := r.GetOutput(ctx, id, false)
					if err != nil {
						return nil, err
					}
					if stored != nil {
						dependency, exists = *stored, true
						byID[id] = dependency
					}
				}
				if !exists || dependency.ChannelID != job.ChannelID || dependency.State != OutputSucceeded {
					hold.DependencyTaskID = id
					switch {
					case !exists || dependency.ChannelID != job.ChannelID:
						hold.Reason = "依存先の出力が見つかりません"
					case dependency.LastError != "":
						hold.Reason = dependency.LastError
					case dependency.State == OutputCancelled:
						hold.Reason = "依存先の出力が取り消されています"
					case job.Kind == OutputDeleteAll:
						hold.Reason = deleteAwaitingCreation
					default:
						hold.Reason = notificationAwaitingDestination
					}
					status.Holds = append(status.Holds, hold)
					continue
				}
			}
			if job.State == OutputUncertain || job.State == OutputBlocked || job.Payload.HoldCreation || job.LastError == notificationAwaitingDestination {
				status.Holds = append(status.Holds, hold)
			}
		}
		return status, nil
	})
}
