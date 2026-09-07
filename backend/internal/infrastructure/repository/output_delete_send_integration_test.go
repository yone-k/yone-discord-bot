//go:build integration

package repository_test

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

type deletionGateway struct {
	application.DiscordGateway
	pages          [][]application.DiscordMessage
	fetches, bulks int
	deleted        []string
	failBulk       bool
	failID         string
	missingID      string
	afterBulk      func()
	bulkError      error
	singleError    error
	beforeSingle   func(string)
}

func (g *deletionGateway) ListMessages(_ context.Context, channel, before string, limit int) ([]application.DiscordMessage, error) {
	if channel != "100" || before == "" || limit != 100 {
		return nil, errors.New("incorrect deletion page request")
	}
	g.fetches++
	if len(g.pages) == 0 {
		return nil, nil
	}
	page := g.pages[0]
	g.pages = g.pages[1:]
	return page, nil
}
func (g *deletionGateway) BulkDeleteMessages(_ context.Context, _ string, ids []string) error {
	g.bulks++
	if g.bulkError != nil {
		return g.bulkError
	}
	if len(ids) < 2 || len(ids) > 100 {
		return errors.New("invalid bulk size")
	}
	if g.failBulk {
		return errors.New("injected bulk failure")
	}
	g.deleted = append(g.deleted, ids...)
	if g.afterBulk != nil {
		g.afterBulk()
	}
	return nil
}
func (g *deletionGateway) DeleteMessage(_ context.Context, _ string, id string) error {
	if g.beforeSingle != nil {
		g.beforeSingle(id)
	}
	if id == g.failID {
		if g.singleError != nil {
			return g.singleError
		}
		return errors.New("injected single failure")
	}
	if id == g.missingID {
		return &application.DiscordFailure{Kind: application.DiscordUnknownMessage}
	}
	g.deleted = append(g.deleted, id)
	return nil
}
func deletionID(at time.Time) string {
	return strconv.FormatUint(uint64(at.UnixMilli()-1420070400000)<<22, 10)
}

type deletionClock struct{ now time.Time }

func (c *deletionClock) Now() time.Time { return c.now }

func TestDeleteAllPublishesProgressDuringSlowPage(t *testing.T) {
	_, store := rpSetup(t)
	now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
	clock := &deletionClock{now}
	service := application.New(store, clock, ids{})
	job := queuedOutput("100", application.OutputDeleteAll, now)
	job.State, job.Executor = application.OutputRunning, "worker"
	job.Payload.Deletion = &application.DeleteProgress{UpperID: deletionID(now), BeforeID: deletionID(now)}
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(t.Context(), job); return err })
	page := make([]application.DiscordMessage, 4)
	for i := range page {
		page[i] = application.DiscordMessage{ID: deletionID(now.Add(-30*24*time.Hour - time.Duration(i)*time.Second)), ChannelID: "100"}
	}
	gateway := &deletionGateway{pages: [][]application.DiscordMessage{page}}
	gateway.beforeSingle = func(id string) {
		if id == page[2].ID {
			detail, err := service.GetOutputDetails(t.Context(), job.ID)
			if err != nil || len(detail.Task.Payload.Deletion.ConfirmedIDs) != 2 || detail.Task.State != application.OutputRunning {
				t.Fatal("slow page must publish intermediate progress", detail, err)
			}
		}
		clock.now = clock.now.Add(600 * time.Millisecond)
	}
	if err := service.ExecuteDeleteAll(t.Context(), gateway, job.ID, "worker"); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteAllFailedSingleCheckpointIsNotRetriedImplicitly(t *testing.T) {
	db, store := rpSetup(t)
	now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
	job := queuedOutput("100", application.OutputDeleteAll, now)
	job.State, job.Executor = application.OutputRunning, "worker"
	job.Payload.Deletion = &application.DeleteProgress{UpperID: deletionID(now), BeforeID: deletionID(now)}
	rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(t.Context(), job); return err })
	if _, err := db.ExecContext(t.Context(), `CREATE SEQUENCE delete_checkpoint_attempts; CREATE FUNCTION reject_single_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF jsonb_typeof(NEW.payload->'Deletion'->'ConfirmedIDs') = 'array' THEN IF jsonb_array_length(NEW.payload->'Deletion'->'ConfirmedIDs') > 0 THEN PERFORM nextval('delete_checkpoint_attempts'); RAISE EXCEPTION 'checkpoint failure'; END IF; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_single_checkpoint BEFORE UPDATE ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_single_checkpoint()`); err != nil {
		t.Fatal(err)
	}
	page := make([]application.DiscordMessage, 100)
	for i := range page {
		page[i] = application.DiscordMessage{ID: deletionID(now.Add(-30*24*time.Hour - time.Duration(i)*time.Second)), ChannelID: "100"}
	}
	service := application.New(store, fixedClock{now}, ids{})
	gateway := &deletionGateway{pages: [][]application.DiscordMessage{page}}
	if err := service.ExecuteDeleteAll(t.Context(), gateway, job.ID, "worker"); err == nil {
		// FailOutput records a retryable failure and may return nil.
		detail, getErr := service.GetOutputDetails(t.Context(), job.ID)
		if getErr != nil || detail.Task.State != application.OutputRetryWait {
			t.Fatal("checkpoint failure did not retain unfinished work", detail, getErr)
		}
	}
	var attempts int
	if err := db.QueryRowContext(t.Context(), `SELECT last_value FROM delete_checkpoint_attempts WHERE is_called`).Scan(&attempts); err != nil || attempts != 1 {
		t.Fatal("failed checkpoint retried implicitly", attempts, err)
	}
	detail, err := service.GetOutputDetails(t.Context(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Task.Payload.Deletion.ConfirmedIDs) != 0 || len(detail.Task.Payload.Deletion.RemainingIDs) != 100 {
		t.Fatalf("failed checkpoint progress: %+v", detail.Task.Payload.Deletion)
	}
	if _, err := db.ExecContext(t.Context(), `DROP TRIGGER reject_single_checkpoint ON output_tasks`); err != nil {
		t.Fatal(err)
	}
	service = application.New(store, fixedClock{now.Add(time.Hour)}, ids{})
	if err := service.RecoverRunningOutputs(t.Context()); err != nil {
		t.Fatal(err)
	}
	if claimed, err := service.ClaimOutput(t.Context(), "worker"); err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	if err := service.ExecuteDeleteAll(t.Context(), &absentDeletionGateway{gateway}, job.ID, "worker"); err != nil {
		t.Fatal(err)
	}
	detail, err = service.GetOutputDetails(t.Context(), job.ID)
	if err != nil || detail.Task.State != application.OutputSucceeded || len(detail.Task.Payload.Deletion.ConfirmedIDs) != 0 || gateway.bulks != 0 {
		t.Fatal("resumption inferred success from absent messages", detail, err)
	}
}

func TestDeleteAllBatchesSingleResultsAndFlushesBeforePermissionHold(t *testing.T) {
	for _, permissionFailure := range []bool{false, true} {
		t.Run(strconv.FormatBool(permissionFailure), func(t *testing.T) {
			db, store := rpSetup(t)
			now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
			job := queuedOutput("100", application.OutputDeleteAll, now)
			job.State, job.Executor = application.OutputRunning, "worker"
			job.Payload.Deletion = &application.DeleteProgress{UpperID: deletionID(now), BeforeID: deletionID(now)}
			rpWrite(t, store, func(r application.Repository) error { _, err := r.EnqueueOutput(t.Context(), job); return err })
			if _, err := db.ExecContext(t.Context(), `CREATE TABLE deletion_progress_writes(size integer); CREATE FUNCTION count_deletion_progress_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO deletion_progress_writes VALUES(pg_column_size(NEW.payload)); RETURN NEW; END $$; CREATE TRIGGER count_deletion_progress_write AFTER UPDATE ON output_tasks FOR EACH ROW EXECUTE FUNCTION count_deletion_progress_write()`); err != nil {
				t.Fatal(err)
			}
			page := make([]application.DiscordMessage, 100)
			for i := range page {
				page[i] = application.DiscordMessage{ID: deletionID(now.Add(-30*24*time.Hour - time.Duration(i)*time.Second)), ChannelID: "100"}
			}
			gateway := &deletionGateway{pages: [][]application.DiscordMessage{page}}
			gateway.beforeSingle = func(id string) {
				if id != page[0].ID {
					return
				}
				detail, err := application.New(store, fixedClock{now}, ids{}).GetOutputDetails(t.Context(), job.ID)
				if err != nil || len(detail.Task.Payload.Deletion.FetchedIDs) != 100 || len(detail.Task.Payload.Deletion.RemainingIDs) != 100 {
					t.Fatal("page must be committed before deletion", detail, err)
				}
			}
			if permissionFailure {
				gateway.failID = page[2].ID
				gateway.singleError = &application.DiscordFailure{Kind: application.DiscordRejected, HTTPStatus: 403}
			}
			service := application.New(store, fixedClock{now}, ids{})
			if err := service.ExecuteDeleteAll(t.Context(), gateway, job.ID, "worker"); err != nil {
				t.Fatal(err)
			}
			detail, err := service.GetOutputDetails(t.Context(), job.ID)
			if err != nil {
				t.Fatal(err)
			}
			confirmed, remaining, state := 100, 0, application.OutputSucceeded
			if permissionFailure {
				confirmed, remaining, state = 2, 98, application.OutputBlocked
			}
			progress := detail.Task.Payload.Deletion
			if detail.Task.State != state || len(progress.ConfirmedIDs) != confirmed || len(progress.RemainingIDs) != remaining || !progress.FirstAttemptFinished {
				t.Fatal("page results lost before completion/hold", detail)
			}
			var writes int
			if err := db.QueryRowContext(t.Context(), `SELECT count(*) FROM deletion_progress_writes`).Scan(&writes); err != nil {
				t.Fatal(err)
			}
			if writes > 4 {
				t.Fatalf("single deletes rewrote the cumulative payload %d times", writes)
			}
		})
	}
}

func TestDeleteAllPageLimitAndCursorStallHoldWithoutExtraDeletion(t *testing.T) {
	for _, scenario := range []string{"last allowed page", "already at limit", "cursor stalled"} {
		t.Run(scenario, func(t *testing.T) {
			_, store := rpSetup(t)
			ctx := t.Context()
			now := time.Now().UTC().Truncate(time.Millisecond)
			s := application.New(store, fixedClock{now}, ids{})
			before, messageID := deletionID(now), deletionID(now.Add(-time.Hour))
			job := queuedOutput("100", application.OutputDeleteAll, now)
			job.State, job.Executor = application.OutputRunning, "worker"
			job.Payload.Deletion = &application.DeleteProgress{UpperID: before, BeforeID: before, Pages: 999}
			if scenario == "already at limit" {
				job.Payload.Deletion.Pages = 1000
			}
			if scenario == "cursor stalled" {
				messageID = before
			}
			rpWrite(t, store, func(r application.Repository) error {
				if _, err := r.EnqueueOutput(ctx, job); err != nil {
					return err
				}
				return r.PutSuspension(ctx, application.OutputSuspension{ChannelID: "100", SuspendedBy: "999", SuspendedAt: now})
			})
			gateway := &deletionGateway{pages: [][]application.DiscordMessage{{{ID: messageID, ChannelID: "100"}}}}
			if err := s.ExecuteDeleteAll(ctx, gateway, job.ID, "worker"); err != nil {
				t.Fatal(err)
			}
			detail, err := s.GetOutputDetails(ctx, job.ID)
			if err != nil || detail.Task.State != application.OutputBlocked || !detail.Task.Payload.Deletion.FirstAttemptFinished {
				t.Fatal(detail, err)
			}
			wantFetches, wantDeletes := 1, 0
			if scenario == "already at limit" {
				wantFetches = 0
			}
			if scenario == "last allowed page" {
				wantDeletes = 1
			}
			if gateway.fetches != wantFetches || len(gateway.deleted) != wantDeletes || len(detail.Task.Payload.Deletion.ConfirmedIDs) != wantDeletes {
				t.Fatal(gateway, detail.Task.Payload.Deletion)
			}
			if scenario != "cursor stalled" && detail.Task.Payload.Deletion.Pages != 1000 {
				t.Fatal("page limit was not preserved", detail.Task.Payload.Deletion)
			}
			status, err := s.GetOutputStatus(ctx, true, false)
			if err != nil || len(status.Suspensions) != 1 {
				t.Fatal("scan hold resumed the channel", status, err)
			}
		})
	}
}

func TestDeleteAllLostResultCommitDoesNotInferDeletedCount(t *testing.T) {
	db, store := rpSetup(t)
	now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "DeleteAllMessageCommand"})
	if err != nil {
		t.Fatal(err)
	}
	id1, id2 := deletionID(now.Add(-time.Hour)), deletionID(now.Add(-2*time.Hour))
	g := &deletionGateway{pages: [][]application.DiscordMessage{{{ID: id1, ChannelID: "100"}, {ID: id2, ChannelID: "100"}}}}
	g.afterBulk = func() {
		if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_delete_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF jsonb_array_length(NEW.payload->'Deletion'->'ConfirmedIDs') > 0 THEN RAISE EXCEPTION 'injected result failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_delete_result BEFORE UPDATE ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_delete_result()`); err != nil {
			t.Error(err)
		}
	}
	s := application.New(store, fixedClock{now}, ids{})
	job, err := s.RequestDeleteAll(ctx, "100")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ClaimOutput(ctx, "leader"); err != nil {
		t.Fatal(err)
	}
	if err := s.ExecuteDeleteAll(ctx, g, job.ID, "leader"); err == nil {
		t.Fatal("injected commit failure was ignored")
	}
	if _, err := db.ExecContext(ctx, `DROP TRIGGER reject_delete_result ON output_tasks; DROP FUNCTION reject_delete_result()`); err != nil {
		t.Fatal(err)
	}
	if err := s.RecoverRunningOutputs(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ClaimOutput(ctx, "leader"); err != nil {
		t.Fatal(err)
	}
	resumed := &absentDeletionGateway{deletionGateway: g}
	if err := s.ExecuteDeleteAll(ctx, resumed, job.ID, "leader"); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		stored, err := r.GetOutput(ctx, job.ID, false)
		if err != nil {
			return err
		}
		if stored.State != application.OutputSucceeded || len(stored.Payload.Deletion.ConfirmedIDs) != 0 || g.bulks != 1 {
			t.Fatal("unconfirmed deletions were counted or repeated in bulk", stored, g.bulks)
		}
		return nil
	})
}

type absentDeletionGateway struct{ *deletionGateway }

func (g *absentDeletionGateway) DeleteMessage(context.Context, string, string) error {
	return &application.DiscordFailure{Kind: application.DiscordUnknownMessage}
}

func TestDeleteAllBulkBadRequestFallsBackButPermissionFailureBlocks(t *testing.T) {
	for _, status := range []int{400, 403} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			_, store := rpSetup(t)
			now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "DeleteAllMessageCommand"})
			if err != nil {
				t.Fatal(err)
			}
			g := &deletionGateway{bulkError: &application.DiscordFailure{Kind: application.DiscordRejected, HTTPStatus: status}, pages: [][]application.DiscordMessage{{{ID: deletionID(now.Add(-time.Hour)), ChannelID: "100"}, {ID: deletionID(now.Add(-2 * time.Hour)), ChannelID: "100"}}}}
			s := application.New(store, fixedClock{now}, ids{})
			job, err := s.RequestDeleteAll(ctx, "100")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.ClaimOutput(ctx, "leader"); err != nil {
				t.Fatal(err)
			}
			if err := s.ExecuteDeleteAll(ctx, g, job.ID, "leader"); err != nil {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stored, err := r.GetOutput(ctx, job.ID, false)
				if err != nil {
					return err
				}
				want, count := application.OutputSucceeded, 2
				if status == 403 {
					want, count = application.OutputBlocked, 0
				}
				if stored.State != want || !stored.Payload.Deletion.FirstAttemptFinished || len(stored.Payload.Deletion.ConfirmedIDs) != count {
					t.Fatal("incorrect bulk failure handling", stored)
				}
				return nil
			})
		})
	}
}

func TestDeleteAllExecutionPersistsPartialCountAndResumes(t *testing.T) {
	_, store := rpSetup(t)
	now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "DeleteAllMessageCommand"})
	if err != nil {
		t.Fatal(err)
	}
	recent1, recent2 := deletionID(now.Add(-time.Hour)), deletionID(now.Add(-2*time.Hour))
	old, missing := deletionID(now.Add(-14*24*time.Hour)), deletionID(now.Add(-15*24*time.Hour))
	g := &deletionGateway{failBulk: true, failID: old, missingID: missing, pages: [][]application.DiscordMessage{{
		{ID: recent1, ChannelID: "100"}, {ID: recent2, ChannelID: "100"}, {ID: old, ChannelID: "100"}, {ID: missing, ChannelID: "100"},
	}}}
	s := application.New(store, fixedClock{now}, ids{})
	job, err := s.RequestDeleteAll(ctx, "100")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ClaimOutput(ctx, "leader"); err != nil {
		t.Fatal(err)
	}
	if err := s.ExecuteDeleteAll(ctx, g, job.ID, "leader"); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		stored, err := r.GetOutput(ctx, job.ID, false)
		if err != nil {
			return err
		}
		p := stored.Payload.Deletion
		if stored.State != application.OutputRetryWait || !p.FirstAttemptFinished || !p.ScanFinished || len(p.ConfirmedIDs) != 2 || len(p.RemainingIDs) != 1 || p.RemainingIDs[0] != old {
			t.Fatal("incorrect partial deletion", stored, p)
		}
		return nil
	})
	g.failID = ""
	s = application.New(store, fixedClock{now.Add(time.Minute)}, ids{})
	if claimed, err := s.ClaimOutput(ctx, "leader"); err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	if err := s.ExecuteDeleteAll(ctx, g, job.ID, "leader"); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		stored, err := r.GetOutput(ctx, job.ID, false)
		if err != nil {
			return err
		}
		if stored.State != application.OutputSucceeded || len(stored.Payload.Deletion.ConfirmedIDs) != 3 || len(stored.Payload.Deletion.RemainingIDs) != 0 {
			t.Fatal("resume lost progress", stored)
		}
		stop, err := r.GetSuspension(ctx, "100")
		if err != nil {
			return err
		}
		if stop == nil {
			t.Fatal("deletion resumed channel output")
		}
		return nil
	})
	if g.bulks != 1 || len(g.deleted) != 3 || g.fetches != 2 {
		t.Fatalf("bulk=%d deleted=%v fetches=%d", g.bulks, g.deleted, g.fetches)
	}
}
