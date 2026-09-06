//go:build integration

package repository

import (
	"testing"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/dbtest"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
)

func TestTasksReadReferencesInFixedQueriesAndPreserveChannelAndOrder(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Reset(t, db)
	ctx := t.Context()
	if err := (migration.Runner{Directory: "../../../../db/migrations"}).Apply(ctx, db, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO inventory_channels(channel_id,list_title) VALUES('200','inventory');
		INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES
		('200','旧/米','米',5,0),('200','旧/水','水',2,1);
		INSERT INTO remind_channels(channel_id,list_title,linked_inventory_channel_id) VALUES
		('300','many','200'),('310','one','200'),('320','empty',NULL);
		INSERT INTO remind_tasks(channel_id,id,title,interval_days,start_at,next_due_at,created_at,updated_at,position) VALUES
		('300','legacy/二','second',1,now(),now(),now(),now(),1),
		('300','旧task/一','first',1,now(),now(),now(),now(),0),
		('300','refsなし','third',1,now(),now(),now(),now(),2),
		('310','旧task/一','other channel',1,now(),now(),now(),now(),0);
		INSERT INTO remind_task_inventory_items(task_channel_id,task_id,inventory_channel_id,inventory_id,consume,position) VALUES
		('300','旧task/一','200','旧/米',0.000000000000000001,1),
		('300','legacy/二','200','旧/米',1,0),
		('300','旧task/一','200','旧/水',0,0),
		('310','旧task/一','200','旧/米',99,0);
	`); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	queries := 0
	client := ent.NewClient(ent.Driver(&transactionDriver{Conn: entsql.Conn{ExecQuerier: tx}}), ent.Debug(), ent.Log(func(...any) { queries++ }))
	r := &repository{tx: tx, client: client}
	for _, channel := range []string{"310", "300"} {
		queries = 0
		tasks, err := r.Tasks(ctx, channel, false)
		if err != nil {
			t.Fatal(err)
		}
		if queries != 2 {
			t.Fatalf("channel %s: wanted two queries independent of task count; got %d for %d tasks", channel, queries, len(tasks))
		}
		if channel == "310" {
			if len(tasks) != 1 || tasks[0].InventoryItems[0].Consume.String() != "99" {
				t.Fatalf("other channel mixed: %+v", tasks)
			}
			continue
		}
		if len(tasks) != 3 || tasks[0].ID != "旧task/一" || tasks[1].ID != "legacy/二" || tasks[2].ID != "refsなし" {
			t.Fatalf("task order changed: %+v", tasks)
		}
		refs := tasks[0].InventoryItems
		if len(refs) != 2 || refs[0].InventoryID != "旧/水" || refs[1].InventoryID != "旧/米" || refs[1].Consume.String() != "0.000000000000000001" {
			t.Fatalf("reference order or precision changed: %+v", refs)
		}
		if tasks[2].InventoryItems == nil || len(tasks[2].InventoryItems) != 0 {
			t.Fatal("empty references must remain a non-nil empty slice")
		}
	}
	queries = 0
	empty, err := r.Tasks(ctx, "320", false)
	if err != nil || len(empty) != 0 || empty == nil || queries > 2 {
		t.Fatal("empty channel", empty, queries, err)
	}
	queries = 0
	task, err := r.GetTask(ctx, "300", "旧task/一", false)
	if err != nil || queries != 2 || task == nil || len(task.InventoryItems) != 2 || task.InventoryItems[0].InventoryID != "旧/水" {
		t.Fatal("single task mapping", task, queries, err)
	}
}
