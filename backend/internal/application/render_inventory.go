package application

import (
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

func RenderInventoryCard(catalog domain.InventoryCatalog, mode CardMode, page int, now time.Time) (DisplayMessage, error) {
	if mode != "normal" && mode != "delete_selection" {
		return DisplayMessage{}, domain.Fail(domain.CodeInvalidInput, "mode", "Invalid inventory card mode")
	}
	defaultCategory := catalog.Channel.DefaultCategory
	if defaultCategory == "" {
		defaultCategory = "その他"
	}
	groups := map[string][]string{}
	categories := []string{}
	for _, item := range catalog.Items {
		category := ""
		if item.Category != nil {
			category = strings.TrimSpace(*item.Category)
		}
		if category == "" {
			category = defaultCategory
		}
		if _, exists := groups[category]; !exists {
			categories = append(categories, category)
		}
		groups[category] = append(groups[category], "• "+item.Name+": "+formatDisplayQuantity(item.Stock))
	}
	if len(catalog.Items) == 0 {
		categories = append(categories, defaultCategory)
		groups[defaultCategory] = []string{"まだアイテムがありません"}
	}
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
	sections := []string{}
	for _, category := range categories {
		sections = append(sections, "### "+categoryEmoji(category)+" "+category+"\n"+strings.Join(groups[category], "\n"))
	}
	updated := "未更新"
	if len(catalog.Items) > 0 {
		updated = now.In(domain.Tokyo).Format("2006/01/02 15:04")
	}
	content := fmt.Sprintf("## %s\n\n%s\n\n---\n合計: %d項目 | 最終更新: %s", catalog.Channel.ListTitle, strings.Join(sections, "\n\n"), len(catalog.Items), updated)
	children := []DisplayComponent{{Kind: "text", Text: content}}
	if mode == "normal" {
		children = append(children, DisplayComponent{Kind: "row", Children: []DisplayComponent{
			{Kind: "button", CustomID: "inventory_add", Label: "追加", Style: 3},
			{Kind: "button", CustomID: "inventory_update", Label: "更新", Style: 1},
			{Kind: "button", CustomID: "inventory_delete", Label: "削除", Style: 4},
		}})
	} else {
		if len(catalog.Items) > 0 {
			maxPage := (len(catalog.Items) - 1) / 25
			page = min(max(page, 0), maxPage)
			options := []DisplayOption{}
			for _, item := range catalog.Items[page*25 : min((page+1)*25, len(catalog.Items))] {
				category := "その他"
				if item.Category != nil && *item.Category != "" {
					category = *item.Category
				}
				options = append(options, DisplayOption{Label: item.Name, Value: item.ID, Description: category + " / 在庫: " + formatDisplayQuantity(item.Stock)})
			}
			children = append(children, DisplayComponent{Kind: "row", Children: []DisplayComponent{{Kind: "select", CustomID: fmt.Sprintf("inventory_delete_select_%d", page), Placeholder: "削除する在庫を選択してください", MinValues: 1, MaxValues: 1, Options: options}}})
			if maxPage > 0 {
				buttons := []DisplayComponent{}
				if page > 0 {
					buttons = append(buttons, DisplayComponent{Kind: "button", CustomID: fmt.Sprintf("inventory_delete?page=%d", page-1), Label: "前へ", Style: 2})
				}
				if page < maxPage {
					buttons = append(buttons, DisplayComponent{Kind: "button", CustomID: fmt.Sprintf("inventory_delete?page=%d", page+1), Label: "次へ", Style: 2})
				}
				children = append(children, DisplayComponent{Kind: "row", Children: buttons})
			}
		}
		children = append(children, DisplayComponent{Kind: "row", Children: []DisplayComponent{{Kind: "button", CustomID: "inventory_selection_cancel", Label: "キャンセル", Style: 2}}})
	}
	return DisplayMessage{Components: []DisplayComponent{{Kind: "container", Children: children}}}, nil
}

// Display rounds half up to one decimal place without narrowing stored precision.
func formatDisplayQuantity(quantity domain.Quantity) string {
	parts := strings.SplitN(quantity.String(), ".", 2)
	fraction := "00"
	if len(parts) == 2 {
		fraction = parts[1] + "00"
	}
	tenths, _ := new(big.Int).SetString(parts[0]+fraction[:1], 10)
	if fraction[1] >= '5' {
		tenths.Add(tenths, big.NewInt(1))
	}
	whole, remainder := new(big.Int), new(big.Int)
	whole.QuoRem(tenths, big.NewInt(10), remainder)
	if remainder.Sign() == 0 {
		return whole.String()
	}
	return whole.String() + "." + remainder.String()
}
