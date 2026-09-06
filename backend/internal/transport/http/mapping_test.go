package httptransport

import (
	"encoding/json"
	"github.com/oapi-codegen/nullable"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"math"
	"strings"
	"testing"
	"time"
)

func TestMappingPreservesIDsQuantitiesAndRevisionStrings(t *testing.T) {
	q, e := domain.ParseQuantity("9007199254740993.0000000000000000001")
	if e != nil {
		t.Fatal(e)
	}
	task := domain.RemindTask{ID: "legacy not UUID", ChannelID: "18446744073709551615", Revision: math.MaxInt64, InventoryItems: []domain.InventoryConsumption{{InventoryID: "same in other channel", Consume: q}}}
	b, e := json.Marshal(mapTask(task))
	if e != nil {
		t.Fatal(e)
	}
	for _, fragment := range []string{`"id":"legacy not UUID"`, `"revision":"9223372036854775807"`, `"channelId":"18446744073709551615"`, `"consume":"9007199254740993.0000000000000000001"`, `"messageId":null`, `"lastDoneAt":null`} {
		if !strings.Contains(string(b), fragment) {
			t.Fatalf("missing %s in %s", fragment, b)
		}
	}
	inventory := mapInventoryItem(domain.InventoryItem{EntityID: "internal secret", ID: "legacy", Stock: q})
	if inventory.Stock != q.String() || inventory.Id != "legacy" {
		t.Fatal(inventory)
	}
}
func TestMappingUsesUTCExactMillisecondsAndNulls(t *testing.T) {
	at := time.Date(2024, 2, 1, 9, 0, 1, 123456789, domain.Tokyo)
	task := mapTask(domain.RemindTask{CreatedAt: at, UpdatedAt: at, StartAt: at, NextDueAt: at, LastDoneAt: &at})
	if task.CreatedAt != "2024-02-01T00:00:01.123Z" || task.LastDoneAt.MustGet() != task.CreatedAt {
		t.Fatal(task)
	}
	b, e := json.Marshal(task)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(string(b), `"inventoryItems":[]`) {
		t.Fatal(string(b))
	}
	snapshot := mapListSnapshot(domain.List{})
	b, e = json.Marshal(snapshot)
	if e != nil || string(b) != `{"editVersion":"0","items":[]}` {
		t.Fatal(string(b), e)
	}
}
func TestNullableMappingDistinguishesZeroAndNull(t *testing.T) {
	s := ""
	if fromNullable(toNullable(&s)) == nil || *fromNullable(toNullable(&s)) != "" {
		t.Fatal("empty string lost")
	}
	if !toNullable[string](nil).IsNull() {
		t.Fatal("required null missing")
	}
	if fromNullable(nullable.NewNullNullable[string]()) != nil || fromNullable(nullable.Nullable[string]{}) != nil {
		t.Fatal("null became value")
	}
}
func TestParseRevisionRejectsNonCanonicalAndOverflow(t *testing.T) {
	for _, s := range []string{"0", "9007199254740993", "9223372036854775807"} {
		v, e := parseRevision(s)
		if e != nil || v < 0 {
			t.Fatal(v, e)
		}
	}
	for _, s := range []string{"", "-1", "+1", "01", "1.0", "1e2", " 1", "9223372036854775808"} {
		if _, e := parseRevision(s); e == nil {
			t.Fatal(s)
		}
	}
}
func TestParseTimestampRequiresRFC3339Milliseconds(t *testing.T) {
	for _, s := range []string{"2024-02-29T00:00:00.123Z", "2024-02-29T09:00:00.123+09:00"} {
		v, e := parseTimestamp(s)
		if e != nil || v.Nanosecond() != 123000000 || v.Location() != time.UTC {
			t.Fatal(v, e)
		}
	}
	for _, s := range []string{"2023-02-29T00:00:00.123Z", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00.1234Z", "2024-01-01T00:00:00,123Z", "2024-01-01", "0000-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000+24:00", "2024-01-01T00:00:00.000+09:60"} {
		if _, e := parseTimestamp(s); e == nil {
			t.Fatal(s)
		}
	}
}
