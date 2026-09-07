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

func TestTaskRenderingMatchesLegacyRequest(t *testing.T) {
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
		if !strings.HasPrefix(c.Name, "task-") && c.Name != "reminder-notice-parent" {
			continue
		}
		count++
		t.Run(c.Name, func(t *testing.T) {
			var message application.DisplayMessage
			if c.Name == "reminder-notice-parent" {
				message = application.RenderReminderNoticeParent()
			} else {
				var in struct {
					Selection bool
					Task      struct {
						ID, Title          string
						MessageID          *string
						StartAt, NextDueAt time.Time
						LastDoneAt         *time.Time
						IsPaused           bool
						InventoryItems     []struct{ InventoryID, Consume string }
					}
				}
				if err := json.Unmarshal(c.Input, &in); err != nil {
					t.Fatal(err)
				}
				task := domain.RemindTask{ID: in.Task.ID, Title: in.Task.Title, MessageID: in.Task.MessageID, StartAt: in.Task.StartAt, NextDueAt: in.Task.NextDueAt, LastDoneAt: in.Task.LastDoneAt, IsPaused: in.Task.IsPaused}
				for _, ref := range in.Task.InventoryItems {
					consume, err := domain.ParseQuantity(ref.Consume)
					if err != nil {
						t.Fatal(err)
					}
					task.InventoryItems = append(task.InventoryItems, domain.InventoryConsumption{InventoryID: ref.InventoryID, Consume: consume})
				}
				catalog := &domain.InventoryCatalog{Items: []domain.InventoryItem{{ID: "item-0", Name: "在庫0"}}}
				mode := application.CardMode("normal")
				if in.Selection {
					mode = "update_selection"
				}
				message, err = application.RenderTaskCard(task, catalog, mode, fixture.Now)
				if err != nil {
					t.Fatal(err)
				}
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
	if count != 9 {
		t.Fatalf("expected 9 task/parent fixtures got %d", count)
	}
}
