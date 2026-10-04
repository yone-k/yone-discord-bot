package domain

import (
	"strings"
	"time"
	"unicode/utf8"
)

const NotificationNurseryMenu = "nursery_menu"

const (
	nurseryMenuEntryLimit      = 1000
	nurseryMenuIngredientLimit = 500
)

// NurseryMenu is one nursery's meals for a Tokyo calendar day. An empty entry
// means the menu omits that section. Ingredients belong to a section, not to
// an individual dish.
type NurseryMenu struct {
	ID, Date, Lunch, Snack             string
	LunchIngredients, SnackIngredients string
	CreatedAt, UpdatedAt               time.Time
}

// NewNurseryMenu validates the business fields of a draft; ID and timestamps
// are left to the caller.
func NewNurseryMenu(draft NurseryMenu) (NurseryMenu, error) {
	if err := ValidateDate(draft.Date); err != nil {
		return NurseryMenu{}, Fail(CodeInvalidInput, "date", "Invalid calendar date")
	}
	menu := NurseryMenu{Date: draft.Date, Lunch: strings.TrimSpace(draft.Lunch), Snack: strings.TrimSpace(draft.Snack),
		LunchIngredients: strings.TrimSpace(draft.LunchIngredients), SnackIngredients: strings.TrimSpace(draft.SnackIngredients)}
	if menu.Lunch == "" && menu.Snack == "" {
		return NurseryMenu{}, Fail(CodeInvalidInput, "menu", "Lunch or snack is required")
	}
	for _, field := range []struct {
		target, dish, ingredients string
	}{{"lunch", menu.Lunch, menu.LunchIngredients}, {"snack", menu.Snack, menu.SnackIngredients}} {
		if utf8.RuneCountInString(field.dish) > nurseryMenuEntryLimit {
			return NurseryMenu{}, Fail(CodeInvalidInput, field.target, "Dish is too long")
		}
		if utf8.RuneCountInString(field.ingredients) > nurseryMenuIngredientLimit {
			return NurseryMenu{}, Fail(CodeInvalidInput, field.target+"Ingredients", "Ingredients are too long")
		}
		if field.dish == "" && field.ingredients != "" {
			return NurseryMenu{}, Fail(CodeInvalidInput, field.target+"Ingredients", "Ingredients require a dish")
		}
	}
	return menu, nil
}

// ShouldPostNurseryMenu reports the daily delivery window, 07:00 to before
// noon in Tokyo. A delayed worker still posts once within this window.
func ShouldPostNurseryMenu(now time.Time) bool {
	hour := now.In(Tokyo).Hour()
	return hour >= 7 && hour < 12
}
