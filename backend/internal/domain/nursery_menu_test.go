package domain

import (
	"strings"
	"testing"
)

func TestNewNurseryMenuTrimsAndKeepsLineBreaks(t *testing.T) {
	menu, err := NewNurseryMenu("2026-10-02", "  ご飯\n鮭の塩焼き  ", "\t")
	if err != nil {
		t.Fatal(err)
	}
	if menu.Date != "2026-10-02" || menu.Lunch != "ご飯\n鮭の塩焼き" || menu.Snack != "" {
		t.Fatalf("%+v", menu)
	}
}

func TestNewNurseryMenuRequiresOneEntryWithinLimit(t *testing.T) {
	code(t, ignoreMenu(NewNurseryMenu("2026-10-02", " ", "")), "invalid_input")
	if _, err := NewNurseryMenu("2026-10-02", "", strings.Repeat("あ", 1000)); err != nil {
		t.Fatal(err)
	}
	code(t, ignoreMenu(NewNurseryMenu("2026-10-02", strings.Repeat("あ", 1001), "")), "invalid_input")
	code(t, ignoreMenu(NewNurseryMenu("2026-10-02", "ご飯", strings.Repeat("a", 1001))), "invalid_input")
}

func TestNewNurseryMenuRejectsInvalidCalendarDates(t *testing.T) {
	for _, date := range []string{"2026-02-30", "2026-1-02", "", "2026/10/02"} {
		code(t, ignoreMenu(NewNurseryMenu(date, "ご飯", "")), "invalid_input")
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
