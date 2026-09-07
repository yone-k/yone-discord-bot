package application

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestNotificationBodiesMatchLegacy(t *testing.T) {
	data, err := os.ReadFile("testdata/discord_outputs/legacy.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
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
		if !strings.HasPrefix(c.Name, "notice-") {
			continue
		}
		count++
		t.Run(c.Name, func(t *testing.T) {
			var in struct {
				Kind string
				List *struct{ Channel struct{ ListTitle string } }
				Item *struct {
					Name  string
					Until *string
				}
				Reminder *struct {
					Task struct {
						Title               string
						RemindBeforeMinutes int
					}
					Shortages []struct{ Name, Required, Available string }
				}
			}
			if err := json.Unmarshal(c.Input, &in); err != nil {
				t.Fatal(err)
			}
			n := Notification{NotificationToken: NotificationToken{Kind: in.Kind}}
			if in.List != nil {
				n.List = &ListDisplay{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ListTitle: in.List.Channel.ListTitle}}}
			}
			if in.Item != nil {
				n.Item = &domain.ListItem{Name: in.Item.Name, Until: in.Item.Until}
			}
			if in.Reminder != nil {
				n.Reminder = &TaskDisplay{Task: domain.RemindTask{Title: in.Reminder.Task.Title, RemindBeforeMinutes: in.Reminder.Task.RemindBeforeMinutes}}
				for _, row := range in.Reminder.Shortages {
					required, err := domain.ParseQuantity(row.Required)
					if err != nil {
						t.Fatal(err)
					}
					available, err := domain.ParseQuantity(row.Available)
					if err != nil {
						t.Fatal(err)
					}
					n.Reminder.Shortages = append(n.Reminder.Shortages, domain.Shortage{Name: row.Name, Required: required, Available: available})
				}
			}
			message, err := RenderNotification(n)
			if err != nil {
				t.Fatal(err)
			}
			var want string
			if err := json.Unmarshal(c.Output, &want); err != nil {
				t.Fatal(err)
			}
			if message.Content != want || len(message.Components) != 0 {
				t.Fatalf("want %q got %#v", want, message)
			}
		})
	}
	if count != 3 {
		t.Fatalf("want 3 notification fixtures got %d", count)
	}
}
