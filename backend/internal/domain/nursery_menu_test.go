package domain

import (
	"strings"
	"testing"
)

func TestNewNurseryMenuTrimsAndKeepsLineBreaks(t *testing.T) {
	menu, err := NewNurseryMenu(NurseryMenu{Date: "2026-10-02", Lunch: "  ご飯\n鮭の塩焼き  ", Snack: "\t", LunchIngredients: " 米\n鮭 "})
	if err != nil {
		t.Fatal(err)
	}
	if menu.Date != "2026-10-02" || menu.Lunch != "ご飯\n鮭の塩焼き" || menu.Snack != "" || menu.LunchIngredients != "米\n鮭" || menu.SnackIngredients != "" {
		t.Fatalf("%+v", menu)
	}
}

func TestNewNurseryMenuRequiresOneEntryWithinLimit(t *testing.T) {
	code(t, ignoreMenu(NewNurseryMenu(NurseryMenu{Date: "2026-10-02", Lunch: " "})), "invalid_input")
	if _, err := NewNurseryMenu(NurseryMenu{Date: "2026-10-02", Snack: strings.Repeat("あ", 1000)}); err != nil {
		t.Fatal(err)
	}
	code(t, ignoreMenu(NewNurseryMenu(NurseryMenu{Date: "2026-10-02", Lunch: strings.Repeat("あ", 1001)})), "invalid_input")
	code(t, ignoreMenu(NewNurseryMenu(NurseryMenu{Date: "2026-10-02", Lunch: "ご飯", Snack: strings.Repeat("a", 1001)})), "invalid_input")
}

func TestNewNurseryMenuLimitsIngredientsAndRequiresTheirDish(t *testing.T) {
	full := NurseryMenu{Date: "2026-10-02", Lunch: "ご飯", Snack: "牛乳", LunchIngredients: strings.Repeat("米", 500), SnackIngredients: strings.Repeat("🥛", 500)}
	if _, err := NewNurseryMenu(full); err != nil {
		t.Fatal(err)
	}
	for name, draft := range map[string]NurseryMenu{
		"long lunch ingredients":  {Date: "2026-10-02", Lunch: "ご飯", LunchIngredients: strings.Repeat("米", 501)},
		"long snack ingredients":  {Date: "2026-10-02", Snack: "牛乳", SnackIngredients: strings.Repeat("米", 501)},
		"lunch ingredients alone": {Date: "2026-10-02", Snack: "牛乳", LunchIngredients: "米"},
		"snack ingredients alone": {Date: "2026-10-02", Lunch: "ご飯", SnackIngredients: "米粉"},
	} {
		t.Run(name, func(t *testing.T) { code(t, ignoreMenu(NewNurseryMenu(draft)), "invalid_input") })
	}
	if _, err := NewNurseryMenu(NurseryMenu{Date: "2026-10-02", Lunch: "ご飯", SnackIngredients: "  "}); err != nil {
		t.Fatal("blank ingredients without a dish must count as omitted", err)
	}
}

func TestNewNurseryMenuRejectsInvalidCalendarDates(t *testing.T) {
	for _, date := range []string{"2026-02-30", "2026-1-02", "", "2026/10/02"} {
		code(t, ignoreMenu(NewNurseryMenu(NurseryMenu{Date: date, Lunch: "ご飯"})), "invalid_input")
	}
}

func TestShouldPostNurseryMenuOnlyBetweenSevenAndNoonInTokyo(t *testing.T) {
	cases := map[string]bool{
		"2026-10-01T21:59:59Z": false, // 06:59:59 JST
		"2026-10-01T22:00:00Z": true,  // 07:00:00 JST
		"2026-10-02T02:59:59Z": true,  // 11:59:59 JST
		"2026-10-02T03:00:00Z": false, // 12:00:00 JST
	}
	for at, want := range cases {
		if got := ShouldPostNurseryMenu(instant(at)); got != want {
			t.Errorf("%s: got %v", at, got)
		}
	}
}

func ignoreMenu(_ NurseryMenu, err error) error { return err }
