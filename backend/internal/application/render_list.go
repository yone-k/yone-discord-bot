package application

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

func RenderListCard(list domain.List, now time.Time) (DisplayMessage, error) {
	defaultCategory := list.Channel.DefaultCategory
	if defaultCategory == "" {
		defaultCategory = "その他"
	}
	groups := map[string][]string{}
	categories := []string{}
	for _, item := range list.Items {
		category := defaultCategory
		if item.Category != nil && *item.Category != "" {
			category = *item.Category
		}
		text := item.Name
		if item.Until != nil {
			day, err := time.ParseInLocation("2006-01-02", *item.Until, domain.Tokyo)
			if err != nil {
				return DisplayMessage{}, err
			}
			text += " (期限: " + day.Format("1/2") + ")"
		}
		if item.IsCompleted {
			text = "~~" + text + "~~"
		}
		if _, exists := groups[category]; !exists {
			categories = append(categories, category)
		}
		groups[category] = append(groups[category], "• "+text)
	}
	if len(list.Items) == 0 {
		groups[defaultCategory] = []string{"まだアイテムがありません"}
		categories = append(categories, defaultCategory)
	}
	// A collator belongs to this rendering call; its buffers are not shared by workers.
	comparer := collate.New(language.Japanese)
	sort.SliceStable(categories, func(i, j int) bool {
		if categories[i] == "その他" {
			return false
		}
		if categories[j] == "その他" {
			return true
		}
		return comparer.CompareString(categories[i], categories[j]) < 0
	})
	sections := make([]string, 0, len(categories))
	for _, category := range categories {
		sections = append(sections, "### "+categoryEmoji(category)+" "+category+"\n"+strings.Join(groups[category], "\n"))
	}
	updated := "未更新"
	if len(list.Items) > 0 {
		updated = now.In(domain.Tokyo).Format("2006/01/02 15:04")
	}
	content := fmt.Sprintf("## %s\n\n%s\n\n---\n合計: %d項目 | 最終更新: %s", list.Channel.ListTitle, strings.Join(sections, "\n\n"), len(list.Items), updated)
	return DisplayMessage{Components: []DisplayComponent{{Kind: "container", Children: []DisplayComponent{
		{Kind: "text", Text: content},
		{Kind: "row", Children: []DisplayComponent{
			{Kind: "button", CustomID: "add-list-button", Label: "追加", Emoji: "➕", Style: 3},
			{Kind: "button", CustomID: "edit-list-button", Label: "編集", Emoji: "📝", Style: 1},
			{Kind: "button", CustomID: "init-list-button", Label: "同期", Emoji: "🔄", Style: 1},
		}},
	}}}}, nil
}

func categoryEmoji(category string) string {
	emoji := map[string]string{"重要": "🔥", "通常": "📝", "その他": "📦", "食料品": "🍎", "日用品": "🧽", "衣類": "👕", "電化製品": "⚡", "本": "📚", "薬": "💊", "掃除": "🧹", "文房具": "✏️"}[category]
	if emoji == "" {
		return "📋"
	}
	return emoji
}
