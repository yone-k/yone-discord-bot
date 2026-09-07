package application

import (
	"fmt"
	"strings"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func RenderNotification(notification Notification) (DisplayMessage, error) {
	if notification.Kind == domain.NotificationList {
		if notification.List == nil || notification.Item == nil || notification.Item.Until == nil {
			return DisplayMessage{}, domain.Fail(domain.CodeInvalidInput, "notification", "List notification data is required")
		}
		title := notification.List.Channel.ListTitle
		if title == "" {
			title = "リスト"
		}
		return DisplayMessage{Content: "@everyone 【" + title + "】" + notification.Item.Name + " の期限日(" + strings.ReplaceAll(*notification.Item.Until, "-", "/") + ")です。"}, nil
	}
	if notification.Reminder == nil {
		return DisplayMessage{}, domain.Fail(domain.CodeInvalidInput, "notification", "Task notification data is required")
	}
	task := notification.Reminder.Task
	switch notification.Kind {
	case domain.NotificationOverdue:
		return DisplayMessage{Content: "@everyone " + task.Title + "の期限が切れています。"}, nil
	case domain.NotificationBefore:
		content := "@everyone " + task.Title + "の期限まであと" + formatRemainingMinutes(task.RemindBeforeMinutes) + "になりました。"
		if len(notification.Reminder.Shortages) > 0 {
			content += "\n不足している在庫の詳細は以下の通りです"
			for _, item := range notification.Reminder.Shortages {
				missing := domain.Quantity{}
				if item.Required.Compare(item.Available) > 0 {
					var err error
					missing, err = item.Required.Subtract(item.Available)
					if err != nil {
						return DisplayMessage{}, err
					}
				}
				content += "\n" + item.Name + " " + formatDisplayQuantity(missing) + "個"
			}
		}
		return DisplayMessage{Content: content}, nil
	default:
		return DisplayMessage{}, domain.Fail(domain.CodeInvalidInput, "kind", "Invalid notification kind")
	}
}

func formatRemainingMinutes(total int) string {
	total = max(0, total)
	days, hours, minutes := total/1440, total%1440/60, total%60
	text := ""
	if days > 0 {
		text += fmt.Sprintf("%d日", days)
	}
	if hours > 0 {
		text += fmt.Sprintf("%d時間", hours)
	}
	if minutes > 0 || text == "" {
		text += fmt.Sprintf("%d分", minutes)
	}
	return text
}
