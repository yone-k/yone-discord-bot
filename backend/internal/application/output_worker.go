package application

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// Execute dispatches every supported output kind. Runtime wiring supplies the
// handlers, keeping the worker's lifecycle separate from individual effects.
type OutputWorker struct {
	Service          *Service
	Leadership       OutputLeadership
	Execute          func(context.Context, OutputTask, string) error
	OnError          func(error)
	started, running atomic.Bool
	reportMu         sync.Mutex
}

func (w *OutputWorker) Running() bool { return w.running.Load() }

func (w *OutputWorker) Run(ctx context.Context) error {
	if w.Service == nil || w.Leadership == nil || w.Execute == nil {
		return errors.New("output worker dependencies are required")
	}
	if !w.started.CompareAndSwap(false, true) {
		return errors.New("output worker is already running")
	}
	defer w.started.Store(false)
	for ctx.Err() == nil {
		// A normal process shutdown allows in-flight work up to ten seconds.
		// Lease loss still cancels all request contexts immediately.
		acquireCtx, cancelAcquire := context.WithCancel(context.WithoutCancel(ctx))
		stopAcquire := context.AfterFunc(ctx, cancelAcquire)
		lease, err := w.Leadership.Acquire(acquireCtx)
		stopAcquire()
		if err == nil {
			if ctx.Err() == nil {
				err = w.runLease(ctx, lease)
			}
			w.running.Store(false)
			if closeErr := lease.Close(); closeErr != nil {
				w.report(closeErr)
			}
		}
		cancelAcquire()
		if err != nil && !errors.Is(err, ErrOutputLeadershipBusy) && ctx.Err() == nil {
			w.report(err)
		}
		if !waitOutputTick(ctx) {
			break
		}
	}
	return nil
}

func (w *OutputWorker) runLease(ctx context.Context, lease OutputLease) error {
	executor, err := w.Service.ids.NewID()
	if err != nil {
		return err
	}
	startupCtx, cancelStartup := context.WithCancel(lease.Context())
	stopStartup := context.AfterFunc(ctx, cancelStartup)
	err = w.Service.RecoverRunningOutputs(startupCtx)
	if err == nil {
		err = w.Service.ReserveStartupOutputs(startupCtx)
	}
	stopStartup()
	cancelStartup()
	if err != nil {
		return err
	}
	execCtx, cancelExecution := context.WithCancel(lease.Context())
	defer cancelExecution()
	var pending sync.WaitGroup
	noticeCtx, cancelNotice := context.WithCancel(execCtx)
	stopNotice := context.AfterFunc(ctx, cancelNotice)
	defer stopNotice()
	defer cancelNotice()
	pending.Add(1)
	go func() {
		defer pending.Done()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for noticeCtx.Err() == nil {
			if err := w.Service.ReserveNotifications(noticeCtx); err != nil && noticeCtx.Err() == nil {
				w.report(err)
			}
			select {
			case <-noticeCtx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	w.running.Store(true)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	claim := func() {
		for ctx.Err() == nil && execCtx.Err() == nil {
			job, err := w.Service.ClaimOutput(execCtx, executor)
			if err != nil {
				w.report(err)
				return
			}
			if job == nil {
				return
			}
			pending.Add(1)
			go func(job OutputTask) {
				defer pending.Done()
				if ctx.Err() != nil {
					return
				}
				if err := execCtx.Err(); err != nil {
					return
				}
				if err := w.Execute(execCtx, job, executor); err != nil {
					w.report(err)
					// A transient DB outage must not strand this channel in running.
					for execCtx.Err() == nil {
						if saveErr := w.Service.failRunningOutput(execCtx, job.ID, executor, err); saveErr == nil {
							break
						} else {
							w.report(saveErr)
						}
						if !waitOutputTick(execCtx) {
							break
						}
					}
				}
			}(*job)
		}
	}
	claim()
	for ctx.Err() == nil && execCtx.Err() == nil {
		select {
		case <-ctx.Done():
		case <-execCtx.Done():
		case <-ticker.C:
			claim()
		}
	}
	w.running.Store(false)
	done := make(chan struct{})
	go func() { pending.Wait(); close(done) }()
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		cancelExecution()
	}
	return nil
}

func (w *OutputWorker) report(err error) {
	if w.OnError == nil {
		return
	}
	w.reportMu.Lock()
	defer w.reportMu.Unlock()
	w.OnError(err)
}

func waitOutputTick(ctx context.Context) bool {
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (s *Service) failRunningOutput(ctx context.Context, taskID, executor string, cause error) error {
	var dispatchID string
	owned := false
	err := s.store.Read(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, false)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return nil
		}
		owned = true
		history, err := r.OutputDispatches(ctx, taskID)
		if err != nil {
			return err
		}
		for _, dispatch := range history {
			if dispatch.Outcome == DispatchUnknown {
				dispatchID = dispatch.ID
				break
			}
		}
		return nil
	})
	if err != nil || !owned {
		return err
	}
	var failure *domain.Error
	if dispatchID == "" && errors.As(cause, &failure) && failure.Code == domain.CodeInvalidInput {
		cause = &DiscordFailure{Kind: DiscordRejected}
	}
	return s.FailOutput(ctx, taskID, executor, dispatchID, cause)
}
