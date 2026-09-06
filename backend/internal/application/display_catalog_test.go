package application

import (
	"context"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type displayCatalogRepository struct {
	notificationRepository
	catalogReads int
}

func (r *displayCatalogRepository) Catalogs(context.Context) ([]domain.InventoryChannel, error) {
	return []domain.InventoryChannel{{ChannelSettings: domain.ChannelSettings{ChannelID: "9"}}}, nil
}
func (r *displayCatalogRepository) GetCatalog(context.Context, string, bool) (*domain.InventoryCatalog, error) {
	r.catalogReads++
	stock, _ := domain.ParseQuantity("2")
	return &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "9"}}, Items: []domain.InventoryItem{{ID: "stock", Name: "rice", Stock: stock}}}, nil
}
func (*displayCatalogRepository) RemindChannels(context.Context) ([]domain.RemindChannelSettings, error) {
	id := "9"
	return []domain.RemindChannelSettings{
		{ChannelSettings: domain.ChannelSettings{ChannelID: "3"}, LinkedInventoryChannelID: &id},
		{ChannelSettings: domain.ChannelSettings{ChannelID: "4"}, LinkedInventoryChannelID: &id},
	}, nil
}
func (r *displayCatalogRepository) Tasks(_ context.Context, channel string, _ bool) ([]domain.RemindTask, error) {
	message := "55"
	consume, _ := domain.ParseQuantity("3")
	task := domain.RemindTask{ID: "a", ChannelID: channel, MessageID: &message, NextDueAt: time.Date(2026, 9, 6, 0, 0, 0, 0, time.UTC), InventoryItems: []domain.InventoryConsumption{{InventoryID: "stock", Consume: consume}}}
	other := task
	other.ID = "b"
	return []domain.RemindTask{task, other}, nil
}
func TestDisplayReadsShareCatalogWithinOneOperation(t *testing.T) {
	for _, operation := range []string{"initialization", "related", "poll"} {
		t.Run(operation, func(t *testing.T) {
			repo := &displayCatalogRepository{}
			clock := &countingClock{time: time.Date(2026, 9, 6, 0, 0, 0, 0, time.UTC)}
			service := New(readStore{repo}, clock, nil)
			var displays []TaskDisplay
			switch operation {
			case "initialization":
				result, err := service.GetInitialization(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				displays = result.Reminders
			case "related":
				var err error
				displays, err = service.GetRelatedTasks(context.Background(), "9")
				if err != nil {
					t.Fatal(err)
				}
			case "poll":
				result, err := service.PollNotifications(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				for _, notification := range result.Notifications {
					displays = append(displays, *notification.Reminder)
				}
			}
			if len(displays) != 4 {
				t.Fatalf("lost tasks: %d", len(displays))
			}
			for _, display := range displays {
				if len(display.Shortages) != 1 || display.Shortages[0].Required.String() != "3" {
					t.Fatalf("lost shortage: %#v", display.Shortages)
				}
			}
			if repo.catalogReads != 1 {
				t.Fatalf("catalog loaded %d times for one read operation", repo.catalogReads)
			}
		})
	}
}
