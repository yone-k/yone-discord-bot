package application

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func (s *Service) ExecuteDeleteAll(ctx context.Context, gateway DiscordGateway, taskID, executor string) error {
	job, err := read(s, ctx, func(r Repository) (*OutputTask, error) { return r.GetOutput(ctx, taskID, false) })
	if err != nil {
		return err
	}
	if job == nil || job.State != OutputRunning || job.Executor != executor {
		return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
	}
	if job.Kind != OutputDeleteAll || job.Payload.Deletion == nil {
		return domain.Fail(domain.CodeInvalidInput, taskID, "Missing deletion progress")
	}
	p := job.Payload.Deletion
	fetchedSet, confirmedSet := map[string]bool{}, map[string]bool{}
	for _, id := range p.FetchedIDs {
		fetchedSet[id] = true
	}
	for _, id := range p.ConfirmedIDs {
		confirmedSet[id] = true
	}
	unsavedResults := 0
	saveFailed := false
	lastSavedAt := s.now()
	save := func(complete bool) error {
		if err := s.saveDeleteProgress(ctx, taskID, executor, *p, complete); err != nil {
			saveFailed = true
			return err
		}
		unsavedResults, lastSavedAt = 0, s.now()
		return nil
	}
	// Persisted remaining IDs may already have been deleted before a response
	// or result commit was lost. Single DELETE distinguishes 404 from success;
	// retrying them in bulk would incorrectly count already absent messages.
	remove := func(id string, confirmed bool) error {
		p.RemainingIDs = slices.DeleteFunc(p.RemainingIDs, func(value string) bool { return value == id })
		if confirmed && !confirmedSet[id] {
			p.ConfirmedIDs = append(p.ConfirmedIDs, id)
			confirmedSet[id] = true
		}
		unsavedResults++
		// Bound cumulative-payload writes to one page or one second of
		// progress. Results are also flushed before leaving the single loop.
		if unsavedResults >= 100 || s.now().Sub(lastSavedAt) >= time.Second {
			return save(false)
		}
		return nil
	}
	var lastFailure error
	deleteSingles := func(ids []string) (result error) {
		defer func() {
			if unsavedResults > 0 && !saveFailed {
				if err := save(false); err != nil {
					result = err
				}
			}
		}()
		for _, id := range ids {
			if err := ctx.Err(); err != nil {
				return err
			}
			err := gateway.DeleteMessage(ctx, job.ChannelID, id)
			if err == nil {
				if err := remove(id, true); err != nil {
					return err
				}
				continue
			}
			var failure *DiscordFailure
			if errors.As(err, &failure) {
				if failure.Kind == DiscordUnknownMessage {
					if err := remove(id, false); err != nil {
						return err
					}
					continue
				}
				if deletePermissionFailure(failure) {
					return err
				}
			}
			lastFailure = err
		}
		return nil
	}
	if err := deleteSingles(slices.Clone(p.RemainingIDs)); err != nil {
		return s.finishDeleteFailure(ctx, taskID, executor, err)
	}
	for !p.ScanFinished {
		if p.Pages >= 1000 {
			return s.holdDeleteScan(ctx, taskID, executor, "メッセージ取得上限に達しました")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		messages, err := gateway.ListMessages(ctx, job.ChannelID, p.BeforeID, 100)
		if err != nil {
			return s.finishDeleteFailure(ctx, taskID, executor, err)
		}
		p.Pages++
		if len(messages) == 0 {
			p.ScanFinished = true
			if err := save(false); err != nil {
				return err
			}
			break
		}
		before, err := strconv.ParseUint(p.BeforeID, 10, 64)
		if err != nil {
			return domain.Fail(domain.CodeInvalidInput, taskID, "Invalid deletion cursor")
		}
		upper, err := strconv.ParseUint(p.UpperID, 10, 64)
		if err != nil {
			return domain.Fail(domain.CodeInvalidInput, taskID, "Invalid deletion upper bound")
		}
		next := before
		fresh, recent := []string{}, []string{}
		if len(messages) > 100 {
			return s.holdDeleteScan(ctx, taskID, executor, "不正なメッセージ取得件数")
		}
		for _, message := range messages {
			id, err := strconv.ParseUint(message.ID, 10, 64)
			if err != nil || id == 0 || id >= before || id > upper || message.ChannelID != job.ChannelID {
				return s.holdDeleteScan(ctx, taskID, executor, "メッセージ取得位置を確認できません")
			}
			if id < next {
				next = id
			}
			if fetchedSet[message.ID] {
				continue
			}
			p.FetchedIDs = append(p.FetchedIDs, message.ID)
			fetchedSet[message.ID] = true
			p.RemainingIDs = append(p.RemainingIDs, message.ID)
			fresh = append(fresh, message.ID)
			created := time.UnixMilli(int64(id>>22) + 1420070400000)
			if created.After(s.now().Add(-14 * 24 * time.Hour)) {
				recent = append(recent, message.ID)
			}
		}
		if next >= before {
			return s.holdDeleteScan(ctx, taskID, executor, "メッセージ取得位置が進みません")
		}
		if len(fresh) == 0 {
			return s.holdDeleteScan(ctx, taskID, executor, "取得済みのメッセージだけが返されました")
		}
		p.BeforeID = strconv.FormatUint(next, 10)
		// The page and all target IDs must be committed before any deletion.
		if err := save(false); err != nil {
			return err
		}
		if len(recent) >= 2 {
			if err := ctx.Err(); err != nil {
				return err
			}
			err := gateway.BulkDeleteMessages(ctx, job.ChannelID, recent)
			if err == nil {
				for _, id := range recent {
					p.RemainingIDs = slices.DeleteFunc(p.RemainingIDs, func(value string) bool { return value == id })
					if !confirmedSet[id] {
						p.ConfirmedIDs = append(p.ConfirmedIDs, id)
						confirmedSet[id] = true
					}
				}
				if err := save(false); err != nil {
					return err
				}
				fresh = slices.DeleteFunc(fresh, func(id string) bool { return slices.Contains(recent, id) })
			} else {
				var failure *DiscordFailure
				if errors.As(err, &failure) && deletePermissionFailure(failure) {
					return s.finishDeleteFailure(ctx, taskID, executor, err)
				}
				// Failed/unknown bulk requests fall through to individual DELETE.
				// Missing messages do not contribute to the confirmed count.
			}
		}
		if err := deleteSingles(fresh); err != nil {
			return s.finishDeleteFailure(ctx, taskID, executor, err)
		}
	}
	if len(p.RemainingIDs) != 0 {
		if lastFailure == nil {
			lastFailure = errors.New("some messages remain undeleted")
		}
		return s.finishDeleteFailure(ctx, taskID, executor, lastFailure)
	}
	p.FirstAttemptFinished = true
	return save(true)
}

func (s *Service) saveDeleteProgress(ctx context.Context, taskID, executor string, progress DeleteProgress, complete bool) error {
	return s.store.Write(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, true)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		job.Payload.Deletion, job.UpdatedAt = &progress, s.now()
		if complete {
			job.State, job.Executor, job.LastError = OutputSucceeded, "", ""
		}
		return r.PutOutput(ctx, *job)
	})
}

func (s *Service) finishDeleteFailure(ctx context.Context, taskID, executor string, cause error) error {
	var failure *DiscordFailure
	if errors.As(cause, &failure) && failure.Kind == DiscordRejected && !deletePermissionFailure(failure) {
		cause = errors.New("message deletion was rejected")
	}
	return s.FailOutput(ctx, taskID, executor, "", cause)
}

func deletePermissionFailure(failure *DiscordFailure) bool {
	return failure.Kind == DiscordUnknownChannel || failure.Kind == DiscordRejected && (failure.HTTPStatus == 0 || failure.HTTPStatus == 401 || failure.HTTPStatus == 403)
}

func (s *Service) holdDeleteScan(ctx context.Context, taskID, executor, reason string) error {
	return s.store.Write(ctx, func(r Repository) error {
		job, err := r.GetOutput(ctx, taskID, true)
		if err != nil {
			return err
		}
		if job == nil || job.State != OutputRunning || job.Executor != executor {
			return domain.Fail(domain.CodeConflict, taskID, "Output execution ownership changed")
		}
		job.State, job.Executor, job.LastError, job.UpdatedAt = OutputBlocked, "", reason, s.now()
		job.Payload.Deletion.FirstAttemptFinished = true
		return r.PutOutput(ctx, *job)
	})
}
