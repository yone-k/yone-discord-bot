package discord

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestInventoryRenderingMatchesLegacyRequest(t *testing.T) {
	data, err := os.ReadFile("../../application/testdata/discord_outputs/legacy.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Now   time.Time
		Cases []struct {
			Name   string
			Input  json.RawMessage
			Output json.RawMessage
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, c := range fixture.Cases {
		if !strings.HasPrefix(c.Name, "inventory-") {
			continue
		}
		count++
		t.Run(c.Name, func(t *testing.T) {
			var in struct {
				Title, DefaultCategory string
				Page                   int
				Items                  []struct {
					ID, Name, Stock string
					Category        *string
				}
			}
			if err := json.Unmarshal(c.Input, &in); err != nil {
				t.Fatal(err)
			}
			catalog := domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ListTitle: in.Title}, DefaultCategory: in.DefaultCategory}}
			for _, item := range in.Items {
				stock, err := domain.ParseQuantity(item.Stock)
				if err != nil {
					t.Fatal(err)
				}
				catalog.Items = append(catalog.Items, domain.InventoryItem{ID: item.ID, Name: item.Name, Stock: stock, Category: item.Category})
			}
			mode := application.CardMode("normal")
			if strings.Contains(c.Name, "-delete-") {
				mode = "delete_selection"
			}
			message, err := application.RenderInventoryCard(catalog, mode, in.Page, fixture.Now)
			if err != nil {
				t.Fatal(err)
			}
			payload, err := messagePayload(message, false)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			var got, want any
			if err := json.Unmarshal(encoded, &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(c.Output, &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("request mismatch\ngot: %s\nwant: %s", encoded, c.Output)
			}
		})
	}
	if count != 10 {
		t.Fatalf("expected 10 inventory fixtures got %d", count)
	}
}
