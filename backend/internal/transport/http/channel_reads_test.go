package httptransport

import (
	"context"
	"errors"
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

type channelOnlyRepository struct{ application.Repository }

func (channelOnlyRepository) GetList(context.Context, string, bool) (*domain.List, error) {
	return nil, errors.New("settings reads must not load list items")
}
func (channelOnlyRepository) GetCatalog(context.Context, string, bool) (*domain.InventoryCatalog, error) {
	return nil, errors.New("settings reads must not load inventory items")
}
func (channelOnlyRepository) GetListChannel(_ context.Context, id string) (*domain.ListChannel, error) {
	return &domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: id, ListTitle: "List"}, DefaultCategory: "food", EditVersion: 42}, nil
}
func (channelOnlyRepository) GetInventoryChannel(_ context.Context, id string) (*domain.InventoryChannel, error) {
	return &domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: id, ListTitle: "Inventory"}, DefaultCategory: "food"}, nil
}
func TestChannelSettingsDoNotLoadAggregateItems(t *testing.T) {
	h := Handler{Service: application.New(&handlerStore{repository: channelOnlyRepository{}}, nil, nil)}
	list, err := h.GetListChannel(context.Background(), api.GetListChannelRequestObject{ChannelId: "1"})
	if err != nil {
		t.Fatal(err)
	}
	if list.(api.GetListChannel200JSONResponse).EditVersion != "42" {
		t.Fatal("settings revision lost")
	}
	inventory, err := h.GetInventoryChannel(context.Background(), api.GetInventoryChannelRequestObject{ChannelId: "2"})
	if err != nil {
		t.Fatal(err)
	}
	if inventory.(api.GetInventoryChannel200JSONResponse).ChannelId != "2" {
		t.Fatal("channel identity lost")
	}
}
