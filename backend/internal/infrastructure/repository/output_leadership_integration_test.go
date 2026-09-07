//go:build integration

package repository_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

func TestOutputLeadershipHasOneOwnerAndCancelsOnConnectionLoss(t *testing.T) {
	db, _ := rpSetup(t)
	leaders := repository.NewOutputLeadership(os.Getenv("TEST_DATABASE_URL"))
	first, err := leaders.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = first.Close() })
	if second, err := leaders.Acquire(t.Context()); !errors.Is(err, application.ErrOutputLeadershipBusy) {
		if second != nil {
			_ = second.Close()
		}
		t.Fatal("multiple leaders admitted", err)
	}
	var terminated bool
	if err := db.QueryRowContext(t.Context(), `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=44001 AND granted`).Scan(&terminated); err != nil || !terminated {
		t.Fatal("cannot terminate isolated test leader", err)
	}
	select {
	case <-first.Context().Done():
	case <-time.After(4 * time.Second):
		t.Fatal("lost leader still permits output")
	}
	second, err := leaders.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	if second.Context().Err() == nil {
		t.Fatal("closed leader context still active")
	}
	third, err := leaders.Acquire(context.Background())
	if err != nil {
		t.Fatal("Close retained session lock", err)
	}
	if err := third.Close(); err != nil {
		t.Fatal(err)
	}
}
