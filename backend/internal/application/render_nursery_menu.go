package application

import (
	"fmt"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

var japaneseWeekdays = [...]string{"日", "月", "火", "水", "木", "金", "土"}

// RenderNurseryMenu mentions everyone outside the card so the push
// notification fires, then shows only the sections the menu contains.
func RenderNurseryMenu(menu domain.NurseryMenu) DisplayMessage {
	day, _ := time.ParseInLocation(time.DateOnly, menu.Date, domain.Tokyo)
	heading := fmt.Sprintf("## 🍱 %d/%d(%s) の献立", int(day.Month()), day.Day(), japaneseWeekdays[day.Weekday()])
	children := []DisplayComponent{{Kind: "text", Text: heading}}
	for _, section := range []struct{ label, text string }{{"昼食", menu.Lunch}, {"おやつ", menu.Snack}} {
		if section.text != "" {
			children = append(children, DisplayComponent{Kind: "text", Text: "**" + section.label + "**\n" + section.text})
		}
	}
	return DisplayMessage{Components: []DisplayComponent{{Kind: "text", Text: "@everyone"}, {Kind: "container", Children: children}}}
}
