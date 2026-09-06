//go:build integration

package repository

import (
	"fmt"
	"strings"
	"testing"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/dbtest"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
)

func TestAggregateWritesUpdateOnlyChangedRows(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	ctx := t.Context()
	if err := (migration.Runner{Directory: "../../../../db/migrations"}).Apply(ctx, db, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
	INSERT INTO inventory_channels(channel_id,list_title) VALUES('200','inventory');
	INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES('200','legacy/一','米',1.000,0),('200','legacy/二','水',2.00,1);
	INSERT INTO list_channels(channel_id,list_title) VALUES('100','list');
	INSERT INTO list_items(channel_id,name,category,until,last_notified_at,position) VALUES
	('100','one','食品','2026-09-01','2026-09-01T12:34:56.789Z',0),('100','two',NULL,NULL,NULL,1);
	`); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var logs []string
	client := ent.NewClient(ent.Driver(&transactionDriver{Conn: entsql.Conn{ExecQuerier: tx}}), ent.Debug(), ent.Log(func(args ...any) { logs = append(logs, fmt.Sprint(args...)) }))
	r := &repository{tx: tx, client: client}
	count := func(table string) int {
		n := 0
		for _, log := range logs {
			if strings.Contains(log, `UPDATE "`+table+`"`) {
				n++
			}
		}
		return n
	}
	assertUpdates := func(table string, want int) {
		t.Helper()
		if got := count(table); got != want {
			t.Fatalf("%s UPDATE count: want %d, got %d\n%v", table, want, got, logs)
		}
	}
	list, err := r.GetList(ctx, "100", false)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := r.GetCatalog(ctx, "200", false)
	if err != nil {
		t.Fatal(err)
	}
	list.Channel.ListTitle = "new list title"
	catalog.Channel.ListTitle = "new catalog title"
	logs = nil
	if err := r.PutList(ctx, list); err != nil {
		t.Fatal(err)
	}
	if err := r.PutCatalog(ctx, catalog); err != nil {
		t.Fatal(err)
	}
	assertUpdates("list_items", 0)
	assertUpdates("inventory_items", 0)
	assertUpdates("list_channels", 1)
	assertUpdates("inventory_channels", 1)
	var stock string
	if err := tx.QueryRowContext(ctx, "SELECT stock::text FROM inventory_items WHERE channel_id='200' AND id='legacy/一'").Scan(&stock); err != nil || stock != "1.000" {
		t.Fatal("equivalent numeric scale was rewritten", stock, err)
	}
	logs = nil
	if err := r.PutList(ctx, list); err != nil {
		t.Fatal(err)
	}
	if err := r.PutCatalog(ctx, catalog); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"list_items", "inventory_items", "list_channels", "inventory_channels"} {
		assertUpdates(table, 0)
	}
	list.Items[1].IsCompleted = true
	quantity, err := domain.ParseQuantity("3.000000000000000001")
	if err != nil {
		t.Fatal(err)
	}
	catalog.Items[1].Stock = quantity
	logs = nil
	if err := r.PutList(ctx, list); err != nil {
		t.Fatal(err)
	}
	if err := r.PutCatalog(ctx, catalog); err != nil {
		t.Fatal(err)
	}
	assertUpdates("list_items", 1)
	assertUpdates("inventory_items", 1)
	assertUpdates("list_channels", 0)
	assertUpdates("inventory_channels", 0)
	// Nullable clearing changes the item; a numeric-equivalent unchanged sibling does not.
	list.Items[0].Category = nil
	list.Items[0].Until = nil
	list.Items[0].LastNotifiedAt = nil
	logs = nil
	if err := r.PutList(ctx, list); err != nil {
		t.Fatal(err)
	}
	assertUpdates("list_items", 1)
	// Renames must still vacate both names before a swap, preserving identity.
	catalog.Items[0].Name, catalog.Items[1].Name = catalog.Items[1].Name, catalog.Items[0].Name
	logs = nil
	if err := r.PutCatalog(ctx, catalog); err != nil {
		t.Fatal(err)
	}
	assertUpdates("inventory_items", 4)
	got, err := r.GetCatalog(ctx, "200", false)
	if err != nil {
		t.Fatal(err)
	}
	for i := range got.Items {
		if got.Items[i].ID != catalog.Items[i].ID || got.Items[i].EntityID != catalog.Items[i].EntityID || got.Items[i].Name != catalog.Items[i].Name {
			t.Fatal("rename changed identity", got.Items)
		}
	}
}
