package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

type fakeControl struct {
	calls []string
	actor application.OutputOperation
}

func (f *fakeControl) BindOutput(ctx context.Context, _ application.DiscordGateway, botID, id, stage, messageID string) error {
	f.calls = append(f.calls, "bind "+id+" "+stage+" "+messageID)
	f.actor, _ = application.OutputOperationFromContext(ctx)
	return nil
}
func (f *fakeControl) ReconcileOutput(ctx context.Context, _ application.DiscordGateway, botID, id, stage string) (bool, error) {
	f.calls = append(f.calls, "reconcile "+id+" "+stage)
	f.actor, _ = application.OutputOperationFromContext(ctx)
	return false, nil
}

type unusedGateway struct{ application.DiscordGateway }

func TestBindingCommandsRequireIdentityAndReportUnresolvedSearch(t *testing.T) {
	id := "01992c1d-c100-7000-8000-000000000001"
	for _, command := range []string{"bind", "reconcile"} {
		args := []string{command, "--actor", "999", "--stage", "thread"}
		if command == "bind" {
			args = append(args, "--discord-id", "300")
		}
		args = append(args, id)
		opts, err := parseOptions(args)
		if err != nil {
			t.Fatal(err)
		}
		service := &fakeControl{}
		var output bytes.Buffer
		if err := execute(t.Context(), opts, service, &output); err == nil || len(service.calls) != 0 {
			t.Fatal("unverified bot accepted")
		}
		if err := execute(t.Context(), opts, service, &output, verifiedDiscord{gateway: unusedGateway{}, botID: "998"}); err != nil {
			t.Fatal(err)
		}
		if len(service.calls) != 1 || service.actor.ActorID != "999" || service.actor.Kind != "outputctl" {
			t.Fatal(service)
		}
		if command == "reconcile" && !strings.Contains(output.String(), `"resolved": false`) {
			t.Fatal(output.String())
		}
	}
}

func TestBindingCommandsAcceptRecordedReplacementStage(t *testing.T) {
	for _, command := range []string{"bind", "reconcile"} {
		for _, stage := range []string{"message:1", "message:12", "message:0", "message:01", "message:-1", "message:", "thread:1"} {
			args := []string{command, "--actor", "999", "--stage", stage}
			if command == "bind" {
				args = append(args, "--discord-id", "300")
			}
			args = append(args, "01992c1d-c100-7000-8000-000000000001")
			_, err := parseOptions(args)
			valid := stage == "message:1" || stage == "message:12"
			if (err == nil) != valid {
				t.Fatalf("%s %s: %v", command, stage, err)
			}
		}
	}
}

func (f *fakeControl) ListOutputJobs(context.Context, application.OutputFilter) ([]application.OutputTask, error) {
	return []application.OutputTask{{ID: "job", ChannelID: "100", Kind: application.OutputOperationLog, State: application.OutputUncertain, LastError: "unknown"}}, nil
}
func (f *fakeControl) GetOutputStatus(context.Context, bool, bool) (*application.OutputStatus, error) {
	return &application.OutputStatus{Counts: []application.OutputStateCount{{State: application.OutputUncertain, Count: 1}}}, nil
}
func (f *fakeControl) GetOutputDetails(context.Context, string) (*application.OutputDetails, error) {
	return &application.OutputDetails{Task: application.OutputTask{ID: "job", Payload: application.OutputPayload{MessageID: "200"}}, Operation: &application.OperationRecord{Facts: application.OperationFacts{Message: "private body"}}}, nil
}
func (f *fakeControl) CancelOutput(ctx context.Context, id string) error {
	f.calls = append(f.calls, "cancel "+id)
	f.actor, _ = application.OutputOperationFromContext(ctx)
	return nil
}
func (f *fakeControl) RetryOutputConfirmedUnsent(ctx context.Context, id string, confirmed bool) error {
	if !confirmed {
		return errors.New("missing confirmation")
	}
	f.calls = append(f.calls, "retry "+id)
	f.actor, _ = application.OutputOperationFromContext(ctx)
	return nil
}

func TestControlArgumentsRejectUnsafeOrAmbiguousRequests(t *testing.T) {
	id := "01992c1d-c100-7000-8000-000000000001"
	for _, args := range [][]string{{"cancel", id}, {"retry-confirm-unsent", "--actor", "999", id}, {"cancel", "--actor", "999", "bad-id"}, {"list", "--limit", "1001"}, {"unknown"}} {
		if _, err := parseOptions(args); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
}

func TestControlCommandPassesRealOperatorAndExplicitConfirmation(t *testing.T) {
	id := "01992c1d-c100-7000-8000-000000000001"
	for _, command := range []string{"cancel", "retry-confirm-unsent"} {
		args := []string{command, "--actor", "999"}
		if command == "retry-confirm-unsent" {
			args = append(args, "--confirm-unsent")
		}
		args = append(args, id)
		options, err := parseOptions(args)
		if err != nil {
			t.Fatal(err)
		}
		service := &fakeControl{}
		var output bytes.Buffer
		if err := execute(t.Context(), options, service, &output); err != nil {
			t.Fatal(err)
		}
		if len(service.calls) != 1 || service.actor.ActorID != "999" || service.actor.Kind != "outputctl" {
			t.Fatal(service)
		}
	}
}

func TestControlReadOutputIncludesQueueStateWithoutOperationBody(t *testing.T) {
	for _, args := range [][]string{{"list"}, {"detail", "01992c1d-c100-7000-8000-000000000001"}} {
		options, err := parseOptions(args)
		if err != nil {
			t.Fatal(err)
		}
		var output bytes.Buffer
		service := &fakeControl{}
		if err := execute(t.Context(), options, service, &output); err != nil {
			t.Fatal(err)
		}
		if len(service.calls) != 0 || strings.Contains(output.String(), "private body") {
			t.Fatal(output.String())
		}
		if !strings.Contains(output.String(), "job") {
			t.Fatal("missing job", output.String())
		}
	}
	if strings.Contains(safeError(errors.New("postgres://user:secret@host/db")), "secret") {
		t.Fatal("database credential exposed")
	}
}
