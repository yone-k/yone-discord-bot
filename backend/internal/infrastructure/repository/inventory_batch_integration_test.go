//go:build integration

package repository_test

import (
	"reflect"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestInventoryBatchRecordsOneOutcomeAfterSkippingDuplicates(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		t.Run(map[bool]string{false: "mixed duplicates", true: "invalid later item"}[invalid], func(t *testing.T) {
			db, store := rpSetup(t)
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "999", Kind: "InventoryAddModalHandler", InteractionID: "888"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, "INSERT INTO inventory_channels(channel_id,list_title,default_category) VALUES('100','inventory','その他'); INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES('100','old','existing',9,0)"); err != nil {
				t.Fatal(err)
			}
			service := application.New(store, fixedClock{time.Now().UTC()}, ids{})
			items := []domain.InventoryItem{{Name: "existing", Stock: rpQuantity(t, "1")}, {Name: "new", Stock: rpQuantity(t, "2")}, {Name: "new", Stock: rpQuantity(t, "3")}}
			if invalid {
				items = append(items, domain.InventoryItem{Name: ""})
			}
			skipped, err := service.AppendInventoryItems(ctx, "100", items)
			if invalid {
				if err == nil {
					t.Fatal("invalid entry accepted")
				}
			} else if err != nil || !reflect.DeepEqual(skipped, []string{"existing", "new"}) {
				t.Fatal(skipped, err)
			}
			var count int
			wantItems, wantOperations := 2, 1
			if invalid {
				wantItems, wantOperations = 1, 0
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM inventory_items").Scan(&count); err != nil || count != wantItems {
				t.Fatal("partial batch committed", count, err)
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records WHERE success").Scan(&count); err != nil || count != wantOperations {
				t.Fatal("incorrect operation outcome", count, err)
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM output_tasks WHERE kind='operation_log'").Scan(&count); err != nil || count != 0 {
				t.Fatal("inventory modal gained Discord logs", count, err)
			}
			var stock string
			if err := db.QueryRowContext(ctx, "SELECT stock::text FROM inventory_items WHERE id='old'").Scan(&stock); err != nil || stock != "9" {
				t.Fatal(stock, err)
			}
		})
	}
}
