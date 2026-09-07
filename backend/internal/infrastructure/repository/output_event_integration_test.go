//go:build integration

package repository_test

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	httptransport "github.com/yone-k/yone-discord-bot/backend/internal/transport/http"
)

func TestOutputEventDeduplicatesAndKeepsOriginalDestination(t *testing.T) {
	db, store := rpSetup(t)
	now := time.Date(2026, 9, 1, 12, 34, 0, 0, time.UTC)
	actor := application.OutputOperation{ActorID: "999", Kind: "AddListModalHandler", InteractionID: "888"}
	ctx, err := application.WithOutputOperation(t.Context(), actor)
	if err != nil {
		t.Fatal(err)
	}
	list := &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list", OperationLogThreadID: rpPtr("200")}, DefaultCategory: "その他"}}
	rpWrite(t, store, func(r application.Repository) error { return r.PutList(ctx, list) })
	s := application.New(store, fixedClock{now.Add(time.Hour)}, ids{})
	event := application.OutputLogEvent{ActorID: actor.ActorID, ChannelID: "100", OperationKind: actor.Kind, InteractionID: actor.InteractionID, OccurredAt: now, Message: "入力エラー", CancelReason: "取消"}
	first, err := s.RecordOutputEvent(ctx, event)
	if err != nil || len(first) != 1 {
		t.Fatal(first, err)
	}
	list.Channel.OperationLogThreadID = rpPtr("201")
	rpWrite(t, store, func(r application.Repository) error { return r.PutList(ctx, list) })
	if duplicate, err := s.RecordOutputEvent(ctx, event); err != nil || len(duplicate) != 0 {
		t.Fatal("duplicate event reserved a log", duplicate, err)
	}
	rpRead(t, store, func(r application.Repository) error {
		job, err := r.GetOutput(ctx, first[0], false)
		if err != nil {
			return err
		}
		op, err := r.GetOperation(ctx, job.OperationID)
		if err != nil {
			return err
		}
		if job.Payload.DestinationID != "200" || op.Success || !op.OccurredAt.Equal(now) || op.Facts.Message != event.Message || op.Facts.CancelReason != event.CancelReason {
			t.Fatal("event evidence changed", job, op)
		}
		return nil
	})
	// Non-posting UI handlers retain an internal record without a new log.
	actor.Kind, actor.InteractionID = "InventorySelectionCancelButtonHandler", "889"
	ctx, err = application.WithOutputOperation(t.Context(), actor)
	if err != nil {
		t.Fatal(err)
	}
	event.OperationKind, event.InteractionID = actor.Kind, actor.InteractionID
	if jobs, err := s.RecordOutputEvent(ctx, event); err != nil || len(jobs) != 0 {
		t.Fatal(jobs, err)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != 2 {
		t.Fatal("internal event record missing", count, err)
	}
	event.ActorID = "998"
	if _, err := s.RecordOutputEvent(ctx, event); err == nil {
		t.Fatal("actor mismatch accepted")
	}
}

func TestBusinessHTTPRejectionRecordsAfterRollback(t *testing.T) {
	_, store := rpSetup(t)
	now := time.Now().UTC().Truncate(time.Millisecond)
	ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "EditListModalHandler", InteractionID: "888"})
	if err != nil {
		t.Fatal(err)
	}
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list", OperationLogThreadID: rpPtr("200")}, DefaultCategory: "その他"}})
	})
	s := application.New(store, fixedClock{now}, ids{})
	routes, err := httptransport.NewBusinessRoutes(s, func(context.Context) error { return nil }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("DELETE", "/v1/lists/100/items/missing", nil)
	request.Header.Set("X-Actor-Id", "999")
	request.Header.Set("X-Operation-Kind", "EditListModalHandler")
	request.Header.Set("X-Interaction-Id", "888")
	response := httptest.NewRecorder()
	routes.ServeHTTP(response, request)
	if response.Code != 404 {
		t.Fatal(response.Code, response.Body.String())
	}
	rpRead(t, store, func(r application.Repository) error {
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: "100"})
		if err != nil {
			return err
		}
		if len(jobs) != 1 || jobs[0].Kind != application.OutputOperationLog {
			t.Fatal("business rejection not recorded", jobs)
		}
		op, err := r.GetOperation(ctx, jobs[0].OperationID)
		if err != nil {
			return err
		}
		if op.Success || op.Facts.Message != "対象が見つかりません。画面を開き直してください。" {
			t.Fatal(op)
		}
		return nil
	})
}

func TestOutputEventReservationFailureRollsBackOperation(t *testing.T) {
	db, store := rpSetup(t)
	now := time.Now().UTC().Truncate(time.Millisecond)
	actor := application.OutputOperation{ActorID: "999", Kind: "AddListModalHandler", InteractionID: "888"}
	ctx, err := application.WithOutputOperation(t.Context(), actor)
	if err != nil {
		t.Fatal(err)
	}
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list", OperationLogThreadID: rpPtr("200")}, DefaultCategory: "その他"}})
	})
	if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_ui_output() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER reject_ui_output BEFORE INSERT ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_ui_output()`); err != nil {
		t.Fatal(err)
	}
	s := application.New(store, fixedClock{now}, ids{})
	event := application.OutputLogEvent{ActorID: actor.ActorID, ChannelID: "100", OperationKind: actor.Kind, InteractionID: actor.InteractionID, OccurredAt: now, Message: "入力エラー"}
	if _, err := s.RecordOutputEvent(ctx, event); err == nil {
		t.Fatal("reservation failure ignored")
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed event poisoned deduplication key", count, err)
	}
	if _, err := db.ExecContext(ctx, `DROP TRIGGER reject_ui_output ON output_tasks; DROP FUNCTION reject_ui_output()`); err != nil {
		t.Fatal(err)
	}
	if tasks, err := s.RecordOutputEvent(ctx, event); err != nil || len(tasks) != 1 {
		t.Fatal("event retry failed", tasks, err)
	}
}
