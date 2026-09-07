//go:build integration

package repository_test

import (
	"encoding/json"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
)

func TestOutputEntBuilderAllowsDatabaseGeneratedOrder(t *testing.T) {
	db, _ := rpSetup(t)
	client := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.Postgres, db)))
	now := time.Now().UTC().Truncate(time.Microsecond)
	for range 2 {
		created, err := client.OutputTask.Create().
			SetChannelID("100").SetKind("operation_log").SetTargetID("100").
			SetPayload(json.RawMessage(`{}`)).SetDestinationKey("100").
			SetState("pending").SetAvailableAt(now).SetCreatedAt(now).SetUpdatedAt(now).
			Save(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if created.ID.Version() != 7 {
			t.Fatal("database UUIDv7 default was not used", created.ID)
		}
	}
	rows, err := client.OutputTask.Query().All(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].OutputOrder <= 0 || rows[1].OutputOrder <= 0 || rows[0].OutputOrder == rows[1].OutputOrder {
		t.Fatalf("database did not assign distinct output order: %+v", rows)
	}
	for _, row := range rows {
		if !row.AvailableAt.Equal(now) || string(row.Payload) != "{}" {
			t.Fatal("timestamp or JSON changed during persistence", row)
		}
	}
}
