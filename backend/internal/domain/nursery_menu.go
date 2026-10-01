package domain

import (
	"strings"
	"time"
	"unicode/utf8"
)

const NotificationNurseryMenu = "nursery_menu"

const nurseryMenuEntryLimit = 1000

// NurseryMenu is one nursery's meals for a Tokyo calendar day. An empty entry
// means the menu omits that section.
type NurseryMenu struct {
	ID, Date, Lunch, Snack string
	CreatedAt, UpdatedAt   time.Time
}

func NewNurseryMenu(date, lunch, snack string) (NurseryMenu, error) {
	if err := ValidateDate(date); err != nil {
		return NurseryMenu{}, Fail(CodeInvalidInput, "date", "Invalid calendar date")
	}
	menu := NurseryMenu{Date: date, Lunch: strings.TrimSpace(lunch), Snack: strings.TrimSpace(snack)}
	if menu.Lunch == "" && menu.Snack == "" {
		return NurseryMenu{}, Fail(CodeInvalidInput, "menu", "Lunch or snack is required")
	}
	if utf8.RuneCountInString(menu.Lunch) > nurseryMenuEntryLimit {
		return NurseryMenu{}, Fail(CodeInvalidInput, "lunch", "Lunch is too long")
	}
	if utf8.RuneCountInString(menu.Snack) > nurseryMenuEntryLimit {
		return NurseryMenu{}, Fail(CodeInvalidInput, "snack", "Snack is too long")
	}
	return menu, nil
}

// ShouldPostNurseryMenu reports the daily delivery window, 07:00 to before
// noon in Tokyo. A delayed worker still posts once within this window.
func ShouldPostNurseryMenu(now time.Time) bool {
	hour := now.In(Tokyo).Hour()
	return hour >= 7 && hour < 12
}
