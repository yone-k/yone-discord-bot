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

func TestListRenderingMatchesLegacyRequest(t *testing.T) {
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
		if !strings.HasPrefix(c.Name, "list-") {
			continue
		}
		count++
		t.Run(c.Name, func(t *testing.T) {
			var in struct {
				Title, DefaultCategory string
				Items                  []struct {
					Name     string
					Category *string
					Until    *time.Time
					Check    bool
				}
			}
			if err := json.Unmarshal(c.Input, &in); err != nil {
				t.Fatal(err)
			}
			list := domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ListTitle: in.Title}, DefaultCategory: in.DefaultCategory}}
			for _, item := range in.Items {
				row := domain.ListItem{Name: item.Name, Category: item.Category, IsCompleted: item.Check}
				if item.Until != nil {
					day := item.Until.In(domain.Tokyo).Format("2006-01-02")
					row.Until = &day
				}
				list.Items = append(list.Items, row)
			}
			message, err := application.RenderListCard(list, fixture.Now)
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
	if count != 3 {
		t.Fatalf("expected 3 list fixtures, got %d", count)
	}
}
