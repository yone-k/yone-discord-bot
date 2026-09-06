package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
	httptransport "github.com/yone-k/yone-discord-bot/backend/internal/transport/http"
)

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

func run(ctx context.Context, logger *slog.Logger) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	db := stdlib.OpenDB(*cfg.Database)
	defer db.Close()
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	runner := migration.Runner{Directory: cfg.Migrations}
	check := func(ctx context.Context) error {
		err := runner.AssertReady(ctx, db)
		if err != nil {
			logger.Warn("Core API readiness failed", "diagnostic", readinessDiagnostic(err).Error())
		}
		return err
	}
	startup, cancel := context.WithTimeout(ctx, 5*time.Second)
	err = check(startup)
	cancel()
	if err != nil {
		return readinessDiagnostic(err)
	}
	service := application.New(repository.New(db), systemClock{}, uuidGenerator{})
	routes, err := httptransport.NewBusinessRoutes(service, check, logger)
	if err != nil {
		return err
	}
	handler, err := httptransport.NewHandler(httptransport.Config{Token: cfg.Token, Check: check, Routes: routes})
	if err != nil {
		return err
	}
	server := newHTTPServer(handler)
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	logger.Info("Core API listening", "address", server.Addr)
	return serve(ctx, server, listener)
}

func readinessDiagnostic(err error) error {
	stage := "unknown"
	var readiness *migration.ReadinessError
	if errors.As(err, &readiness) {
		stage = readiness.Stage
		err = readiness.Err
	}
	detail := fmt.Sprintf("database readiness failed: stage=%s error_type=%T", stage, err)
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		detail += " sqlstate=" + pg.Code
	}
	// Do not wrap or copy the original error: pgx connection errors can include a DSN.
	return errors.New(detail)
}

func newHTTPServer(handler http.Handler) *http.Server {
	return &http.Server{Addr: ":8080", Handler: handler, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 6 * time.Second, WriteTimeout: 7 * time.Second, IdleTimeout: 60 * time.Second}
}

func serve(ctx context.Context, server *http.Server, listener net.Listener) error {
	finished := make(chan error, 1)
	go func() { finished <- server.Serve(listener) }()
	select {
	case err := <-finished:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return err
		}
		return nil
	}
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, logger); err != nil {
		logger.Error("Core API stopped", "error", err)
		os.Exit(1)
	}
}
