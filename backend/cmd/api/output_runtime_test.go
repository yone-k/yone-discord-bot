package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

func TestOutputErrorLoggingPreservesSafeFailureClassification(t *testing.T) {
	for _, failure := range []*application.DiscordFailure{
		{Kind: application.DiscordRejected, HTTPStatus: 401, Code: 50014},
		{Kind: application.DiscordRateLimited, HTTPStatus: 429, RetryAfter: 3 * time.Second},
		{Kind: application.DiscordIndeterminate},
	} {
		var output bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&output, nil))
		logOutputError(logger, "identity", fmt.Errorf("synthetic-secret: %w", failure))
		var record map[string]any
		if err := json.Unmarshal(output.Bytes(), &record); err != nil {
			t.Fatal(err)
		}
		if record["stage"] != "identity" || record["discord_kind"] != string(failure.Kind) || record["http_status"] != float64(failure.HTTPStatus) || record["discord_code"] != float64(failure.Code) || record["retry_after_ms"] != float64(failure.RetryAfter.Milliseconds()) {
			t.Fatal(record)
		}
		if strings.Contains(output.String(), "synthetic-secret") {
			t.Fatal("raw error leaked", output.String())
		}
	}
	var output bytes.Buffer
	logOutputError(slog.New(slog.NewJSONHandler(&output, nil)), "worker", errors.New("postgres://user:synthetic-secret@host/db"))
	if strings.Contains(output.String(), "synthetic-secret") || strings.Contains(output.String(), "discord_kind") {
		t.Fatal(output.String())
	}
}

func TestOutputWorkerConstruction(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test:test@localhost/test")
	t.Setenv("CORE_API_TOKEN", "api-token")
	t.Setenv("DISCORD_OUTPUT_ENABLED", "true")
	t.Setenv("DISCORD_BOT_TOKEN", "bot-token")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	worker, run := outputWorker(cfg, nil, slog.Default())
	if worker == nil || run == nil || worker.Running() {
		t.Fatal("worker construction started IO or lost dependencies")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := run(ctx); err != nil {
		t.Fatal(err)
	}
	cfg.OutputEnabled = false
	if worker, run = outputWorker(cfg, nil, slog.Default()); worker != nil || run != nil {
		t.Fatal("constructed disabled worker")
	}
}

func TestWorkerAndServerStopTogether(t *testing.T) {
	for _, workerFails := range []bool{false, true} {
		t.Run(map[bool]string{false: "server", true: "worker"}[workerFails], func(t *testing.T) {
			failure := errors.New("stopped")
			finished := make(chan struct{})
			wait := func(ctx context.Context) error { <-ctx.Done(); close(finished); return nil }
			fail := func(context.Context) error { return failure }
			server, worker := fail, wait
			if workerFails {
				server, worker = wait, fail
			}
			if err := serveWithWorker(t.Context(), server, worker); !errors.Is(err, failure) {
				t.Fatal(err)
			}
			select {
			case <-finished:
			default:
				t.Fatal("returned before counterpart stopped")
			}
		})
	}
}

func TestDisabledWorkerDoesNotRun(t *testing.T) {
	called := false
	if err := serveWithWorker(t.Context(), func(context.Context) error { called = true; return nil }, nil); err != nil || !called {
		t.Fatal(err)
	}
}
