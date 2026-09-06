//go:build integration

package repository_test

import (
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestRepositoryMessageLookupPreservesChannelScopeAndOrderedExactReferences(t *testing.T) {
	_, store := rpSetup(t)
	catalog, channel, task := rpSeedCatalogTask(t, store)
	task.InventoryItems = append([]domain.InventoryConsumption{{EntityID: rpID(), InventoryID: catalog.Items[1].ID, Consume: rpQuantity(t, "9007199254740993.123456789")}}, task.InventoryItems...)
	otherChannel := *channel
	otherChannel.ChannelID = "400"
	otherTask := *task
	otherTask.EntityID, otherTask.ChannelID, otherTask.InventoryItems = rpID(), otherChannel.ChannelID, []domain.InventoryConsumption{}
	rpWrite(t, store, func(r application.Repository) error {
		if err := r.PutTask(t.Context(), task, channel.LinkedInventoryChannelID, true); err != nil {
			return err
		}
		if err := r.PutRemindChannel(t.Context(), &otherChannel); err != nil {
			return err
		}
		return r.PutTask(t.Context(), &otherTask, otherChannel.LinkedInventoryChannelID, true)
	})
	rpRead(t, store, func(r application.Repository) error {
		got, err := r.GetTaskByMessage(t.Context(), channel.ChannelID, *task.MessageID)
		if err != nil {
			return err
		}
		rpEqual(t, task, got)
		if len(got.InventoryItems) != 2 || got.InventoryItems[0].InventoryID != catalog.Items[1].ID || got.InventoryItems[0].Consume.String() != "9007199254740993.123456789" || got.InventoryItems[1].Consume.String() != "0.00000000000000000001" {
			t.Fatal("message lookup changed reference order or precision")
		}
		other, err := r.GetTaskByMessage(t.Context(), otherChannel.ChannelID, *task.MessageID)
		if err != nil {
			return err
		}
		rpEqual(t, &otherTask, other)
		for _, scope := range [][2]string{{channel.ChannelID, "99999"}, {"99999", *task.MessageID}} {
			missing, err := r.GetTaskByMessage(t.Context(), scope[0], scope[1])
			if err != nil {
				return err
			}
			if missing != nil {
				t.Fatal("message lookup returned a different channel or message")
			}
		}
		return nil
	})
}
