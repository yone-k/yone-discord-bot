//go:build integration

package main

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/dbtest"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

func TestCLIUsesDatabaseAndAuditsCancellation(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	directory := "../../../db/migrations"
	if err := (migration.Runner{Directory: directory}).Apply(t.Context(), db, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(t.Context(), "INSERT INTO data_imports(snapshot_sha256,schema_version,completed_at,report) VALUES(repeat('a',64),1,now(),'{}')"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", os.Getenv("TEST_DATABASE_URL"))
	t.Setenv("MIGRATIONS_DIR", directory)
	store := repository.New(db)
	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()
	if err := store.Write(t.Context(), func(r application.Repository) error {
		_, err := r.EnqueueOutput(t.Context(), application.OutputTask{ID: id, ChannelID: "100", Kind: application.OutputOperationLog, DestinationKey: "log", State: application.OutputPending, CreatedAt: now, UpdatedAt: now, AvailableAt: now})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"list", "--channel", "100"}, {"detail", id}, {"cancel", "--actor", "999", id}} {
		var output bytes.Buffer
		if err := run(t.Context(), args, &output); err != nil {
			t.Fatal(safeError(err))
		}
		if !strings.Contains(output.String(), id) {
			t.Fatal("missing target job", output.String())
		}
	}
	var state, actor string
	if err := db.QueryRowContext(t.Context(), "SELECT state FROM output_tasks WHERE id=$1", id).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(t.Context(), "SELECT actor_id FROM operation_records WHERE operation_kind='outputctl'").Scan(&actor); err != nil {
		t.Fatal(err)
	}
	if state != "cancelled" || actor != "999" {
		t.Fatal(state, actor)
	}
}
