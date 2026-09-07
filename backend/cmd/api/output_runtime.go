package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/discord"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

func outputWorker(cfg config, service *application.Service, logger *slog.Logger) (*application.OutputWorker, func(context.Context) error) {
	if !cfg.OutputEnabled {
		return nil, nil
	}
	gateway := discord.New(http.DefaultClient, discord.APIBaseURL, cfg.DiscordToken, systemClock{})
	worker := &application.OutputWorker{
		Service: service, Leadership: repository.NewOutputLeadership(cfg.Database.ConnString()),
		OnError: func(err error) { logOutputError(logger, "worker", err) },
	}
	run := func(ctx context.Context) error {
		for ctx.Err() == nil {
			botID, err := gateway.CurrentBotID(ctx)
			if err == nil {
				worker.Execute = func(ctx context.Context, job application.OutputTask, executor string) error {
					return service.ExecuteOutput(ctx, gateway, botID, job, executor)
				}
				return worker.Run(ctx)
			}
			logOutputError(logger, "identity", err)
			timer := time.NewTimer(5 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil
			case <-timer.C:
			}
		}
		return nil
	}
	return worker, run
}

func logOutputError(logger *slog.Logger, stage string, err error) {
	attributes := []any{"stage", stage, "error_type", fmt.Sprintf("%T", err)}
	var failure *application.DiscordFailure
	if errors.As(err, &failure) {
		attributes = append(attributes, "discord_kind", failure.Kind, "http_status", failure.HTTPStatus,
			"discord_code", failure.Code, "retry_after_ms", failure.RetryAfter.Milliseconds())
	}
	// Raw transport and database errors can contain credentials or connection URLs.
	logger.Warn("Discord output failed", attributes...)
}

// Keep the DB alive until both the HTTP server and output worker have drained.
func serveWithWorker(ctx context.Context, server, worker func(context.Context) error) error {
	if worker == nil {
		return server(ctx)
	}
	running, cancel := context.WithCancel(ctx)
	defer cancel()
	serverDone, workerDone := make(chan error, 1), make(chan error, 1)
	go func() { serverDone <- server(running) }()
	go func() { workerDone <- worker(running) }()
	select {
	case err := <-serverDone:
		cancel()
		workerErr := <-workerDone
		if err != nil {
			return err
		}
		return workerErr
	case err := <-workerDone:
		if err == nil && running.Err() == nil {
			err = errors.New("output worker stopped unexpectedly")
		}
		cancel()
		serverErr := <-serverDone
		if err != nil {
			return err
		}
		return serverErr
	}
}
