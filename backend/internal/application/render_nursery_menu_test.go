package application

import (
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestRenderNurseryMenuMentionsEveryoneAndShowsACard(t *testing.T) {
	message := RenderNurseryMenu(domain.NurseryMenu{Date: "2026-10-02", Lunch: "ご飯\n鮭", Snack: "牛乳"})
	if message.Content != "" || len(message.Components) != 2 {
		t.Fatalf("%+v", message)
	}
	if mention := message.Components[0]; mention.Kind != "text" || mention.Text != "@everyone" {
		t.Fatalf("%+v", mention)
	}
	card := message.Components[1]
	want := []string{"## 🍱 10/2(金) の献立", "**昼食**\nご飯\n鮭", "**おやつ**\n牛乳"}
	if card.Kind != "container" || len(card.Children) != len(want) {
		t.Fatalf("%+v", card)
	}
	for i, text := range want {
		if card.Children[i].Kind != "text" || card.Children[i].Text != text {
			t.Errorf("%d: %+v", i, card.Children[i])
		}
	}
}

func TestRenderNurseryMenuAddsIngredientsUnderTheirSection(t *testing.T) {
	card := RenderNurseryMenu(domain.NurseryMenu{Date: "2026-10-02", Lunch: "ご飯", Snack: "牛乳", LunchIngredients: "米、鮭"}).Components[1]
	want := []string{"## 🍱 10/2(金) の献立", "**昼食**\nご飯\n材料: 米、鮭", "**おやつ**\n牛乳"}
	if len(card.Children) != len(want) {
		t.Fatalf("%+v", card.Children)
	}
	for i, text := range want {
		if card.Children[i].Text != text {
			t.Errorf("%d: %q", i, card.Children[i].Text)
		}
	}
}

func TestRenderNurseryMenuOmitsEmptySectionsAndUsesTheTokyoWeekday(t *testing.T) {
	for date, heading := range map[string]string{"2026-10-04": "## 🍱 10/4(日) の献立", "2026-12-26": "## 🍱 12/26(土) の献立"} {
		card := RenderNurseryMenu(domain.NurseryMenu{Date: date, Snack: "せんべい"}).Components[1]
		if len(card.Children) != 2 || card.Children[0].Text != heading || card.Children[1].Text != "**おやつ**\nせんべい" {
			t.Fatalf("%s: %+v", date, card.Children)
		}
	}
}
