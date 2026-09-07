package application

import (
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// A nil catalog means inventory display is not configured for the channel.
func RenderTaskCard(task domain.RemindTask, catalog *domain.InventoryCatalog, mode CardMode, now time.Time) (DisplayMessage, error) {
	if mode != "normal" && mode != "update_selection" {
		return DisplayMessage{}, domain.Fail(domain.CodeInvalidInput, "mode", "Invalid task card mode")
	}
	start := task.StartAt
	if task.LastDoneAt != nil {
		start = *task.LastDoneAt
	}
	total := float64(task.NextDueAt.UnixMilli() - start.UnixMilli())
	elapsed := float64(now.UnixMilli() - start.UnixMilli())
	ratio := 1.0
	if total > 0 {
		ratio = min(1, max(0, elapsed/total))
	}
	filled := int(math.Round(ratio * 40))
	progress := "```\n" + strings.Repeat("█", filled) + strings.Repeat("░", 40-filled) + "\n```"
	remaining := task.NextDueAt.UnixMilli() - now.UnixMilli()
	details := ""
	switch {
	case remaining < 0:
		details = "**期限切れ**"
	case remaining > 0 && remaining < 86400000:
		minutes := (remaining + 59999) / 60000
		if minutes < 60 {
			details = fmt.Sprintf("-# 残り: %d分", minutes)
		} else {
			details = fmt.Sprintf("-# 残り: %d時間%d分", minutes/60, minutes%60)
		}
	case remaining < 30*86400000:
		details = fmt.Sprintf("-# 残り: %d日", remaining/86400000)
	default:
		details = "-# 期限: " + task.NextDueAt.In(domain.Tokyo).Format("2006/1/2 15:04")
	}
	if catalog != nil && len(task.InventoryItems) > 0 {
		items := map[string]domain.InventoryItem{}
		for _, item := range catalog.Items {
			items[item.ID] = item
		}
		summary := []string{}
		for _, ref := range task.InventoryItems[:min(3, len(task.InventoryItems))] {
			if item, ok := items[ref.InventoryID]; ok {
				summary = append(summary, item.Name+" "+formatDisplayQuantity(item.Stock))
			} else {
				id := utf16.Encode([]rune(ref.InventoryID))
				summary = append(summary, "[不明な在庫:"+string(utf16.Decode(id[:min(8, len(id))]))+"]")
			}
		}
		details += "\n-# 在庫: " + strings.Join(summary, ", ")
		if len(task.InventoryItems) > 3 {
			details += "..."
		}
	}
	children := []DisplayComponent{{Kind: "text", Text: "## " + task.Title}, {Kind: "text", Text: progress}, {Kind: "text", Text: details}}
	if mode == "normal" {
		children = append(children, DisplayComponent{Kind: "row", Children: []DisplayComponent{
			{Kind: "button", CustomID: "remind-task-detail", Label: "詳細", Style: 2},
			{Kind: "button", CustomID: "remind-task-update", Label: "更新", Style: 1},
			{Kind: "button", CustomID: "remind-task-complete", Label: "完了", Style: 3},
			{Kind: "button", CustomID: "remind-task-delete", Label: "削除", Style: 4},
		}})
	} else {
		if task.MessageID == nil || *task.MessageID == "" {
			return DisplayMessage{}, domain.Fail(domain.CodeInvalidInput, "messageId", "Selection requires a saved message")
		}
		children = append(children,
			DisplayComponent{Kind: "row", Children: []DisplayComponent{{Kind: "select", CustomID: "remind-task-update-select:" + *task.MessageID, Placeholder: "更新内容を選択", Options: []DisplayOption{{Label: "基本設定", Value: "basic"}, {Label: "詳細設定", Value: "advanced"}, {Label: "在庫設定", Value: "inventory"}}}}},
			DisplayComponent{Kind: "row", Children: []DisplayComponent{{Kind: "button", CustomID: "remind-task-update-cancel:" + *task.MessageID, Label: "キャンセル", Style: 2}}},
		)
	}
	return DisplayMessage{Components: []DisplayComponent{{Kind: "container", Children: children}}}, nil
}

func RenderReminderNoticeParent() DisplayMessage {
	return DisplayMessage{Components: []DisplayComponent{{Kind: "container", Children: []DisplayComponent{
		{Kind: "text", Text: "### 通知用スレッド"},
		{Kind: "row", Children: []DisplayComponent{{Kind: "button", CustomID: "remind-task-add", Label: "新規作成", Style: 3}}},
	}}}}
}
