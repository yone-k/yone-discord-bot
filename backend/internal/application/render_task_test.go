package application

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestTaskRemainingTimeBoundaries(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		remaining time.Duration
		want      string
	}{
		{-time.Millisecond, "**期限切れ**"}, {0, "-# 残り: 0日"},
		{time.Millisecond, "-# 残り: 1分"}, {59*time.Minute + time.Millisecond, "-# 残り: 1時間0分"},
		{24*time.Hour - time.Millisecond, "-# 残り: 24時間0分"}, {24 * time.Hour, "-# 残り: 1日"},
		{30*24*time.Hour - time.Millisecond, "-# 残り: 29日"}, {30 * 24 * time.Hour, "-# 期限: 2026/1/31 09:00"},
	} {
		t.Run(tc.remaining.String(), func(t *testing.T) {
			task := domain.RemindTask{Title: "task", StartAt: now.Add(-24 * time.Hour), NextDueAt: now.Add(tc.remaining)}
			message, err := RenderTaskCard(task, nil, "normal", now)
			if err != nil {
				t.Fatal(err)
			}
			if got := message.Components[0].Children[2].Text; got != tc.want {
				t.Fatalf("want %s got %s", tc.want, got)
			}
		})
	}
}

func TestTaskSelectionRequiresSavedMessage(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	task := domain.RemindTask{StartAt: now, NextDueAt: now.Add(time.Hour)}
	if _, err := RenderTaskCard(task, nil, "update_selection", now); err == nil {
		t.Fatal("selection generated without message ID")
	}
}

func TestTaskInventorySummaryTruncatesAfterThreeLegacyItems(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	stock, err := domain.ParseQuantity("1")
	if err != nil {
		t.Fatal(err)
	}
	catalog := &domain.InventoryCatalog{Items: []domain.InventoryItem{
		{ID: "a", Name: "米", Stock: stock}, {ID: "b", Name: "水", Stock: stock},
		{ID: "c", Name: "洗剤", Stock: stock}, {ID: "d", Name: "電池", Stock: stock},
	}}
	refs := []domain.InventoryConsumption{{InventoryID: "a"}, {InventoryID: "b"}, {InventoryID: "c"}, {InventoryID: "d"}}
	// The TS resolveInventorySummary at 0e8dc2c takes the first three and appends
	// exactly "..." only when the original reference count exceeds three.
	for _, tc := range []struct {
		count int
		want  string
	}{
		{3, "-# 残り: 1日\n-# 在庫: 米 1, 水 1, 洗剤 1"},
		{4, "-# 残り: 1日\n-# 在庫: 米 1, 水 1, 洗剤 1..."},
	} {
		task := domain.RemindTask{StartAt: now, NextDueAt: now.Add(24 * time.Hour), InventoryItems: refs[:tc.count]}
		message, err := RenderTaskCard(task, catalog, CardNormal, now)
		if err != nil {
			t.Fatal(err)
		}
		if got := message.Components[0].Children[2].Text; got != tc.want {
			t.Fatalf("%d references: got %q, want %q", tc.count, got, tc.want)
		}
	}
}
