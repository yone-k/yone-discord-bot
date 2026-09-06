//go:build integration

package migration

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/dbtest"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
)

const directory = "../../../../db/migrations"

func mustExec(t *testing.T, db *sql.DB, s string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(t.Context(), s, args...); err != nil {
		t.Fatal(err)
	}
}
func seedV1(t *testing.T, db *sql.DB) {
	t.Helper()
	m, err := Load(directory)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, m[0].SQL)
	mustExec(t, db, "INSERT INTO schema_migrations(version,checksum) VALUES(1,$1)", m[0].Checksum)
	mustExec(t, db, `INSERT INTO list_channels VALUES('100','101','買物','その他','102',17);
 INSERT INTO inventory_channels VALUES('200','201','在庫','食品','202'),('210',NULL,'別在庫','その他',NULL);
 INSERT INTO remind_channels VALUES('300','301','家事','302','303','304','200');
 INSERT INTO list_items VALUES('1fa6d604-e83f-4af4-a89d-6728bc5c6f2a','100','牛乳',NULL,'2026-09-01',false,'2026-09-01T00:00:00.123Z',0),('28b9e239-6bde-439d-86ca-ff25bdb41b9d','100','パン','食品',NULL,true,NULL,1);
 INSERT INTO inventory_items VALUES('200','旧ID/任意','米',123456789012345678901234567890.12345678901234567890,NULL,0),('210','旧ID/任意','別の米',0,'分類',0);
 INSERT INTO remind_tasks(channel_id,id,message_id,title,description,interval_days,time_of_day,remind_before_minutes,start_at,next_due_at,last_done_at,last_remind_due_at,overdue_notify_count,overdue_notify_limit,last_overdue_notified_at,is_paused,created_at,updated_at,revision,position)
 VALUES('300','旧task/任意','305','炊飯',NULL,31,'23:59',10080,'2026-01-31T14:59:00.123Z','2026-03-03T14:59:00.456Z','2026-01-31T14:59:00.789Z','2026-03-03T14:59:00.456Z',2,NULL,'2026-03-01T12:01:02.345Z',true,'2026-01-01T01:02:03.456Z','2026-03-01T01:02:03.789Z',9007199254740993,0);
 INSERT INTO remind_task_inventory_items VALUES('300','旧task/任意','200','旧ID/任意',0.00000000000000000001,0);
 INSERT INTO data_imports VALUES(true,repeat('a',64),1,'2026-01-01T00:00:00.123Z','{"rows":4}');`)
}
func snapshot(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, table := range []string{"list_channels", "inventory_channels", "remind_channels", "list_items", "inventory_items", "remind_tasks", "remind_task_inventory_items", "data_imports"} {
		var v string
		if err := db.QueryRowContext(t.Context(), "SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text FROM (SELECT to_jsonb(t)-'entity_id' AS value FROM "+table+" t) s").Scan(&v); err != nil {
			t.Fatal(err)
		}
		out[table] = v
	}
	return out
}

func TestMigrationPreservesEveryLegacyColumnAndConstraint(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	seedV1(t, db)
	before := snapshot(t, db)
	r := Runner{directory}
	if err := r.Apply(t.Context(), db, ""); err != nil {
		t.Fatal(err)
	}
	if after := snapshot(t, db); !reflect.DeepEqual(before, after) {
		t.Fatalf("legacy values changed: before=%v after=%v", before, after)
	}
	for _, table := range []string{"inventory_items", "remind_tasks", "remind_task_inventory_items"} {
		var n int
		if err := db.QueryRow("SELECT count(*) FROM " + table + " WHERE uuid_extract_version(entity_id)<>7 OR entity_id IS NULL").Scan(&n); err != nil || n != 0 {
			t.Fatal(table, n, err)
		}
	}
	var idsBefore, idsAfter string
	query := "SELECT jsonb_agg(entity_id ORDER BY entity_id)::text FROM inventory_items"
	if err := db.QueryRow(query).Scan(&idsBefore); err != nil {
		t.Fatal(err)
	}
	if err := r.Apply(t.Context(), db, ""); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(query).Scan(&idsAfter); err != nil || idsBefore != idsAfter {
		t.Fatal("reapplication changed IDs", err)
	}
	if err := r.AssertReady(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{"DELETE FROM inventory_items WHERE channel_id='200'", "UPDATE remind_channels SET linked_inventory_channel_id=NULL WHERE channel_id='300'", "UPDATE inventory_items SET stock='NaN'", "UPDATE inventory_items SET stock='Infinity'", "UPDATE remind_tasks SET time_of_day='24:00'", "UPDATE list_items SET until='infinity'"} {
		if _, err := db.Exec(s); err == nil {
			t.Fatalf("constraint lost: %s", s)
		}
	}
	var constraints int
	if err := db.QueryRow("SELECT count(*) FROM pg_constraint WHERE conname IN ('list_item_position_uq','inventory_item_position_uq','remind_task_position_uq') AND condeferrable AND condeferred").Scan(&constraints); err != nil || constraints != 3 {
		t.Fatal("deferred ordering constraints lost", constraints, err)
	}
	mustExec(t, db, "DELETE FROM remind_tasks WHERE channel_id='300'")
	var count int
	if err := db.QueryRow("SELECT count(*) FROM remind_task_inventory_items").Scan(&count); err != nil || count != 0 {
		t.Fatal("cascade lost", err)
	}
}

func TestFailedMigrationRollsBackDDLHistoryAndData(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	seedV1(t, db)
	before := snapshot(t, db)
	m, err := Load(directory)
	if err != nil {
		t.Fatal(err)
	}
	d := t.TempDir()
	for i, name := range []string{"001_initial.sql", "002_ent_uuidv7.sql"} {
		s := m[i].SQL
		if i == 1 {
			s += "\nSELECT 1/0;"
		}
		if err := os.WriteFile(filepath.Join(d, name), []byte(s), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := (Runner{d}).Apply(t.Context(), db, ""); err == nil {
		t.Fatal("broken migration succeeded")
	}
	if !reflect.DeepEqual(before, snapshot(t, db)) {
		t.Fatal("data changed despite rollback")
	}
	var columns int
	if err := db.QueryRow("SELECT count(*) FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='entity_id'").Scan(&columns); err != nil || columns != 0 {
		t.Fatal("DDL not rolled back", err)
	}
	var n int
	if err := db.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&n); err != nil || n != 1 {
		t.Fatal("history not rolled back", err)
	}
}

func TestReadinessChecksumAndRestrictedRole(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	r := Runner{directory}
	mustExec(t, db, "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='issue41_runtime_test') THEN CREATE ROLE issue41_runtime_test NOLOGIN; END IF; END $$")
	if err := r.Apply(t.Context(), db, "issue41_runtime_test"); err != nil {
		t.Fatal(err)
	}
	if err := r.AssertSchema(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	if err := r.AssertReady(t.Context(), db); err == nil {
		t.Fatal("missing marker accepted")
	}
	conn, err := db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(t.Context(), "SET ROLE issue41_runtime_test"); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(context.Background(), "RESET ROLE")
	if _, err := conn.ExecContext(t.Context(), "INSERT INTO list_channels(channel_id,list_title) VALUES('999','test')"); err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{"CREATE TABLE forbidden(id int)", "CREATE TEMP TABLE forbidden(id int)", "TRUNCATE list_channels", "DELETE FROM schema_migrations", "DELETE FROM data_imports"} {
		if _, err := conn.ExecContext(t.Context(), s); err == nil {
			t.Fatalf("privilege granted: %s", s)
		}
	}
	if _, err := conn.ExecContext(t.Context(), "RESET ROLE"); err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, "UPDATE schema_migrations SET checksum=repeat('b',64) WHERE version=1")
	if err := r.AssertSchema(t.Context(), db); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatal("corruption accepted", err)
	}
	if err := r.Apply(t.Context(), db, ""); err == nil {
		t.Fatal("corruption applied")
	}
}

func TestEntMappingAndSQLShareTransaction(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	if err := (Runner{directory}).Apply(t.Context(), db, ""); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	client := ent.NewClient(ent.Driver(entsql.NewDriver(dialect.Postgres, entsql.Conn{ExecQuerier: tx})))
	ctx := t.Context()
	if _, err := client.ListChannel.Create().SetID("100").SetListTitle("list").Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.InventoryChannel.Create().SetID("200").SetListTitle("inventory").Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RemindChannel.Create().SetID("300").SetListTitle("reminder").SetLinkedInventoryChannelID("200").Save(ctx); err != nil {
		t.Fatal(err)
	}
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ListItem.Create().SetID(id).SetChannelID("100").SetName("list item").SetPosition(0).Save(ctx); err != nil {
		t.Fatal(err)
	}
	invID := uuid.Must(uuid.NewV7())
	if _, err := client.InventoryItem.Create().SetID(invID).SetLegacyID(invID.String()).SetChannelID("200").SetName("inventory item").SetStock("999999999999999999999.000000000000000001").SetPosition(0).Save(ctx); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 1, 0, 0, 0, 123000000, time.UTC)
	taskID := uuid.Must(uuid.NewV7())
	if _, err := client.RemindTask.Create().SetID(taskID).SetLegacyID(taskID.String()).SetChannelID("300").SetTitle("task").SetIntervalDays(1).SetTimeOfDay("00:00").SetRemindBeforeMinutes(0).SetStartAt(now).SetNextDueAt(now).SetCreatedAt(now).SetUpdatedAt(now).SetPosition(0).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RemindTaskInventoryItem.Create().SetID(uuid.Must(uuid.NewV7())).SetTaskChannelID("300").SetTaskID(taskID.String()).SetInventoryChannelID("200").SetInventoryID(invID.String()).SetConsume("0.000000000000000001").SetPosition(0).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE inventory_items SET stock=stock-0.000000000000000001"); err != nil {
		t.Fatal(err)
	}
	item, err := client.InventoryItem.Get(ctx, invID)
	if err != nil || item.Stock != "999999999999999999999.000000000000000000" {
		t.Fatal(item, err)
	}
	if _, err := client.RemindTask.Get(ctx, taskID); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RemindTaskInventoryItem.Query().All(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.ListItem.Get(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, err := client.ListChannel.Get(ctx, "100"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.InventoryChannel.Get(ctx, "200"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RemindChannel.Get(ctx, "300"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow("SELECT count(*) FROM inventory_channels").Scan(&n); err != nil || n != 0 {
		t.Fatal("ent write survived rollback", err)
	}
}

func TestRejectsPrivilegedOwnedAndInheritedRoles(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	r := Runner{directory}
	if err := r.Apply(t.Context(), db, ""); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"issue41_owner_test", "issue41_member_test", "issue41_parent_test", "issue41_admin_test"} {
		mustExec(t, db, "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='"+role+"') THEN CREATE ROLE "+role+" NOLOGIN; END IF; END $$")
	}
	mustExec(t, db, "ALTER ROLE issue41_admin_test CREATEDB")
	mustExec(t, db, "GRANT issue41_parent_test TO issue41_member_test")
	mustExec(t, db, "ALTER TABLE list_items OWNER TO issue41_owner_test")
	for _, role := range []string{"issue41_nonexistent_test", "issue41_owner_test", "issue41_member_test", "issue41_admin_test"} {
		if err := r.Apply(t.Context(), db, role); err == nil {
			t.Fatalf("unsafe role accepted: %s", role)
		}
	}
}

func TestReadinessDetectsSchemaMismatchAndEveryConnectionUsesUTC(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	seedV1(t, db)
	r := Runner{directory}
	if err := r.AssertReady(t.Context(), db); err == nil {
		t.Fatal("version one accepted")
	}
	if err := r.Apply(t.Context(), db, ""); err != nil {
		t.Fatal(err)
	}
	var connections []*sql.Conn
	for range 3 {
		conn, err := db.Conn(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		connections = append(connections, conn)
		defer conn.Close()
		var timezone string
		if err := conn.QueryRowContext(t.Context(), "SHOW TIME ZONE").Scan(&timezone); err != nil || timezone != "UTC" {
			t.Fatal(timezone, err)
		}
	}
	if err := r.AssertReady(t.Context(), db); err != nil {
		t.Fatal(err)
	}
}
