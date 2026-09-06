package httptransport

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestMalformedPathIDNeverReachesApplication(t *testing.T) {
	store := &handlerStore{repository: &handlerRepository{}}
	handler, err := NewBusinessRoutes(application.New(store, nil, handlerIDs{}), func(context.Context) error { return nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ name, id string }{
		{"empty", "~"}, {"invalid alphabet", "~!"}, {"padding", "~Lg="},
		{"nonzero trailing bits", "~Lh"}, {"invalid UTF-8", "~_w"}, {"NUL", "~AA"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("GET", "/v1/inventories/901/items/"+test.id, nil))
			if response.Code != 400 || store.reads != 0 || store.writes != 0 {
				t.Fatalf("invalid path ID reached application: status=%d reads=%d writes=%d", response.Code, store.reads, store.writes)
			}
		})
	}
}

func TestLegacyPathIDSurvivesGeneratedParameterBinding(t *testing.T) {
	for _, test := range []struct{ path, id string }{
		{"~Lg", "."}, {"~Li4", ".."}, {"~YS9i", "a/b"},
		{"~JTJF", "%2E"}, {"~fkxn", "~Lg"}, {"legacy-id", "legacy-id"},
	} {
		t.Run(test.id, func(t *testing.T) {
			repo := &handlerRepository{catalog: &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "901"}}, Items: []domain.InventoryItem{{ID: test.id, ChannelID: "901", Name: "item"}}}}
			handler, err := NewBusinessRoutes(application.New(&handlerStore{repository: repo}, nil, handlerIDs{}), func(context.Context) error { return nil }, nil)
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("GET", "/v1/inventories/901/items/"+test.path, nil))
			var item struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
				t.Fatal(err)
			}
			if response.Code != 200 || item.ID != test.id {
				t.Fatalf("ID changed: status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
