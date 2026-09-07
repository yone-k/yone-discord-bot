package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/discord"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

type commandError string

func (e commandError) Error() string { return string(e) }

const usage = commandError("usage: outputctl list [--channel ID] [--state STATE] [--limit 100] | detail JOB_ID | cancel --actor USER_ID JOB_ID | retry-confirm-unsent --actor USER_ID --confirm-unsent JOB_ID | reconcile --actor USER_ID [--stage message|message:N|parent|thread] JOB_ID | bind --actor USER_ID [--stage message|message:N|parent|thread] --discord-id ID JOB_ID")

type options struct {
	command, id, actor string
	stage, discordID   string
	confirmed          bool
	filter             application.OutputFilter
}

func parseOptions(args []string) (options, error) {
	var result options
	if len(args) == 0 {
		return result, usage
	}
	result.command = args[0]
	flags := flag.NewFlagSet("outputctl", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	var state string
	switch result.command {
	case "list":
		flags.StringVar(&result.filter.ChannelID, "channel", "", "channel ID")
		flags.StringVar(&state, "state", "", "output state")
		flags.IntVar(&result.filter.Limit, "limit", 100, "maximum jobs")
	case "detail":
	case "cancel", "retry-confirm-unsent", "bind", "reconcile":
		flags.StringVar(&result.actor, "actor", "", "operator Discord user ID")
		if result.command == "bind" || result.command == "reconcile" {
			flags.StringVar(&result.stage, "stage", "message", "creation stage")
		}
		if result.command == "bind" {
			flags.StringVar(&result.discordID, "discord-id", "", "verified existing message or thread ID")
		}
		if result.command == "retry-confirm-unsent" {
			flags.BoolVar(&result.confirmed, "confirm-unsent", false, "operator verified no creation occurred")
		}
	default:
		return result, usage
	}
	if err := flags.Parse(args[1:]); err != nil {
		return result, usage
	}
	if result.command == "list" {
		if flags.NArg() != 0 || result.filter.Limit < 1 || result.filter.Limit > 1000 {
			return result, usage
		}
		if result.filter.ChannelID != "" && !validDiscordID(result.filter.ChannelID) {
			return result, usage
		}
		if state != "" {
			switch application.OutputState(state) {
			case application.OutputPending, application.OutputRunning, application.OutputRetryWait, application.OutputUncertain, application.OutputBlocked, application.OutputSucceeded, application.OutputCancelled:
				result.filter.States = []application.OutputState{application.OutputState(state)}
			default:
				return result, usage
			}
		}
		return result, nil
	}
	if flags.NArg() != 1 {
		return result, usage
	}
	id, err := uuid.Parse(flags.Arg(0))
	if err != nil {
		return result, usage
	}
	result.id = id.String()
	if result.command != "detail" && !validDiscordID(result.actor) {
		return result, usage
	}
	if result.command == "retry-confirm-unsent" && !result.confirmed {
		return result, usage
	}
	if result.command == "bind" && !validDiscordID(result.discordID) {
		return result, usage
	}
	if (result.command == "bind" || result.command == "reconcile") && !application.IsMessageOutputStage(result.stage) && result.stage != "parent" && result.stage != "thread" {
		return result, usage
	}
	return result, nil
}

func validDiscordID(value string) bool {
	if value == "" || value[0] < '1' || value[0] > '9' {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	id, err := strconv.ParseUint(value, 10, 64)
	return err == nil && id != 0
}

type controlService interface {
	ListOutputJobs(context.Context, application.OutputFilter) ([]application.OutputTask, error)
	GetOutputStatus(context.Context, bool, bool) (*application.OutputStatus, error)
	GetOutputDetails(context.Context, string) (*application.OutputDetails, error)
	CancelOutput(context.Context, string) error
	RetryOutputConfirmedUnsent(context.Context, string, bool) error
	BindOutput(context.Context, application.DiscordGateway, string, string, string, string) error
	ReconcileOutput(context.Context, application.DiscordGateway, string, string, string) (bool, error)
}

// The CLI exposes delivery evidence, but not the captured business-operation body.
type jobSummary struct {
	ID           string                  `json:"id"`
	ChannelID    string                  `json:"channelId"`
	TargetID     string                  `json:"targetId"`
	Kind         application.OutputKind  `json:"kind"`
	State        application.OutputState `json:"state"`
	Reason       string                  `json:"reason"`
	HoldCreation bool                    `json:"holdCreation"`
	Attempts     int                     `json:"attempts"`
	CreatedAt    time.Time               `json:"createdAt"`
	AvailableAt  time.Time               `json:"availableAt"`
}

func summarize(job application.OutputTask) jobSummary {
	return jobSummary{ID: job.ID, ChannelID: job.ChannelID, TargetID: job.TargetID, Kind: job.Kind, State: job.State, Reason: job.LastError, HoldCreation: job.Payload.HoldCreation, Attempts: job.Attempts, CreatedAt: job.CreatedAt, AvailableAt: job.AvailableAt}
}

type verifiedDiscord struct {
	gateway application.DiscordGateway
	botID   string
}

func execute(ctx context.Context, opts options, service controlService, output io.Writer, verification ...verifiedDiscord) error {
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	switch opts.command {
	case "list":
		status, err := service.GetOutputStatus(ctx, false, false)
		if err != nil {
			return err
		}
		jobs, err := service.ListOutputJobs(ctx, opts.filter)
		if err != nil {
			return err
		}
		rows := make([]jobSummary, 0, len(jobs))
		for _, job := range jobs {
			rows = append(rows, summarize(job))
		}
		// Summary covers the entire queue; filters and limit apply only to jobs.
		return encoder.Encode(map[string]any{"counts": status.Counts, "oldestPendingAt": status.OldestPendingAt, "holds": status.Holds, "suspensions": status.Suspensions, "jobs": rows, "limit": opts.filter.Limit, "summaryScope": "all channels and states"})
	case "detail":
		detail, err := service.GetOutputDetails(ctx, opts.id)
		if err != nil {
			return err
		}
		result := map[string]any{"job": summarize(detail.Task), "stages": detail.Task.Payload.Stages, "dispatches": detail.Dispatches, "messageId": detail.Task.Payload.MessageID, "destinationId": detail.Task.Payload.DestinationID, "dependencyTaskId": detail.Task.Payload.DependencyTaskID, "deletion": detail.Task.Payload.Deletion}
		if op := detail.Operation; op != nil {
			result["operation"] = map[string]any{"id": op.ID, "actorId": op.ActorID, "kind": op.Kind, "success": op.Success, "occurredAt": op.OccurredAt}
		}
		return encoder.Encode(result)
	case "cancel", "retry-confirm-unsent":
		var err error
		ctx, err = application.WithOutputOperation(ctx, application.OutputOperation{ActorID: opts.actor, Kind: "outputctl"})
		if err != nil {
			return err
		}
		if opts.command == "cancel" {
			err = service.CancelOutput(ctx, opts.id)
		} else {
			err = service.RetryOutputConfirmedUnsent(ctx, opts.id, opts.confirmed)
		}
		if err != nil {
			return err
		}
		return encoder.Encode(map[string]any{"action": opts.command, "jobId": opts.id, "accepted": true})
	case "bind", "reconcile":
		if len(verification) != 1 || verification[0].gateway == nil || !validDiscordID(verification[0].botID) {
			return commandError("Discord bot identity verification is required")
		}
		ctx, err := application.WithOutputOperation(ctx, application.OutputOperation{ActorID: opts.actor, Kind: "outputctl"})
		if err != nil {
			return err
		}
		v := verification[0]
		resolved := true
		if opts.command == "bind" {
			err = service.BindOutput(ctx, v.gateway, v.botID, opts.id, opts.stage, opts.discordID)
		} else {
			resolved, err = service.ReconcileOutput(ctx, v.gateway, v.botID, opts.id, opts.stage)
		}
		if err != nil {
			return err
		}
		return encoder.Encode(map[string]any{"action": opts.command, "jobId": opts.id, "stage": opts.stage, "resolved": resolved})
	default:
		return usage
	}
}

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

type uuidGenerator struct{}

func (uuidGenerator) NewID() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

func run(ctx context.Context, args []string, output io.Writer) error {
	opts, err := parseOptions(args)
	if err != nil {
		return err
	}
	raw := os.Getenv("DATABASE_URL")
	if raw == "" {
		return commandError("DATABASE_URL is required")
	}
	config, err := pgx.ParseConfig(raw)
	if err != nil {
		return commandError("invalid DATABASE_URL")
	}
	config.ConnectTimeout = 5 * time.Second
	config.RuntimeParams["timezone"] = "UTC"
	db := stdlib.OpenDB(*config)
	defer db.Close()
	db.SetMaxOpenConns(2)
	directory := os.Getenv("MIGRATIONS_DIR")
	if directory == "" {
		directory = "db/migrations"
	}
	runner := migration.Runner{Directory: directory}
	startup, cancel := context.WithTimeout(ctx, 5*time.Second)
	err = runner.AssertReady(startup, db)
	cancel()
	if err != nil {
		return err
	}
	service := application.New(repository.New(db), systemClock{}, uuidGenerator{})
	if opts.command == "bind" || opts.command == "reconcile" {
		token := os.Getenv("DISCORD_BOT_TOKEN")
		if token == "" {
			return commandError("DISCORD_BOT_TOKEN is required for bind and reconcile")
		}
		gateway := discord.New(&http.Client{}, discord.APIBaseURL, token, systemClock{})
		botID, err := gateway.CurrentBotID(ctx)
		if err != nil {
			return commandError("Discord bot identity verification failed")
		}
		return execute(ctx, opts, service, output, verifiedDiscord{gateway: gateway, botID: botID})
	}
	return execute(ctx, opts, service, output)
}

func safeError(err error) string {
	var command commandError
	if errors.As(err, &command) {
		return string(command)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "outputctl timed out; inspect job state before repeating an operation"
	}
	if errors.Is(err, context.Canceled) {
		return "outputctl interrupted; inspect job state before repeating an operation"
	}
	var failure *domain.Error
	if errors.As(err, &failure) {
		switch failure.Code {
		case domain.CodeNotFound:
			return "output job not found"
		case domain.CodeConflict:
			return "output state conflicts with this action; inspect job details"
		case domain.CodeInvalidInput:
			return "invalid output operation; check arguments and operator ID"
		}
	}
	return "outputctl failed; check database connectivity and schema readiness, then inspect job state"
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, safeError(err))
		os.Exit(1)
	}
}
