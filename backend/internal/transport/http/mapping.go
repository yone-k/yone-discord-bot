package httptransport

import (
	"regexp"
	"strconv"
	"time"

	"github.com/oapi-codegen/nullable"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

const timestampLayout = "2006-01-02T15:04:05.000Z07:00"

var revisionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
var timestampPattern = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$`)

func parseRevision(s string) (int64, error) {
	if !revisionPattern.MatchString(s) {
		return 0, domain.Fail("invalid_input", "revision", "Expected canonical nonnegative revision")
	}
	v, e := strconv.ParseInt(s, 10, 64)
	if e != nil {
		return 0, domain.Fail("invalid_input", "revision", "Revision exceeds bigint range")
	}
	return v, nil
}
func parseTimestamp(s string) (time.Time, error) {
	if !timestampPattern.MatchString(s) {
		return time.Time{}, domain.Fail("invalid_input", "timestamp", "Expected RFC3339 millisecond timestamp")
	}
	v, e := time.Parse(timestampLayout, s)
	if e != nil || v.Year() < 1 {
		return time.Time{}, domain.Fail("invalid_input", "timestamp", "Invalid timestamp")
	}
	return v.UTC(), nil
}

// Unspecified and null both map to nil. Patch callers must check IsSpecified
// before conversion so omission continues to mean "leave unchanged".
func fromNullable[T any](value nullable.Nullable[T]) *T {
	if !value.IsSpecified() || value.IsNull() {
		return nil
	}
	v, e := value.Get()
	if e != nil {
		return nil
	}
	return &v
}
func toNullable[T any](value *T) nullable.Nullable[T] {
	if value == nil {
		return nullable.NewNullNullable[T]()
	}
	return nullable.NewNullableWithValue(*value)
}
func mapTimestamp(v time.Time) string { return v.UTC().Format(timestampLayout) }
func mapNullableTimestamp(v *time.Time) nullable.Nullable[string] {
	if v == nil {
		return nullable.NewNullNullable[string]()
	}
	return nullable.NewNullableWithValue(mapTimestamp(*v))
}
func mapListChannel(c domain.ListChannel) api.ListChannel {
	return api.ListChannel{ChannelId: c.ChannelID, MessageId: toNullable(c.MessageID), ListTitle: c.ListTitle, OperationLogThreadId: toNullable(c.OperationLogThreadID), DefaultCategory: c.DefaultCategory, EditVersion: strconv.FormatInt(c.EditVersion, 10)}
}
func mapInventoryChannel(c domain.InventoryChannel) api.InventoryChannel {
	return api.InventoryChannel{ChannelId: c.ChannelID, MessageId: toNullable(c.MessageID), ListTitle: c.ListTitle, OperationLogThreadId: toNullable(c.OperationLogThreadID), DefaultCategory: c.DefaultCategory}
}
func mapRemindChannel(c domain.RemindChannelSettings) api.RemindChannel {
	return api.RemindChannel{ChannelId: c.ChannelID, MessageId: toNullable(c.MessageID), ListTitle: c.ListTitle, OperationLogThreadId: toNullable(c.OperationLogThreadID), RemindNoticeThreadId: toNullable(c.RemindNoticeThreadID), RemindNoticeMessageId: toNullable(c.RemindNoticeMessageID), LinkedInventoryChannelId: toNullable(c.LinkedInventoryChannelID)}
}
func mapListItem(i domain.ListItem) api.StoredListItem {
	return api.StoredListItem{Id: i.ID, ChannelId: i.ChannelID, Name: i.Name, Category: toNullable(i.Category), Until: toNullable(i.Until), IsCompleted: i.IsCompleted, LastNotifiedAt: mapNullableTimestamp(i.LastNotifiedAt), Position: int32(i.Position)}
}
func mapInventoryItem(i domain.InventoryItem) api.StoredInventoryItem {
	return api.StoredInventoryItem{Id: i.ID, ChannelId: i.ChannelID, Name: i.Name, Stock: i.Stock.String(), Category: toNullable(i.Category), Position: int32(i.Position)}
}
func mapTask(t domain.RemindTask) api.StoredRemindTask {
	items := make([]api.InventoryConsumption, len(t.InventoryItems))
	for n, i := range t.InventoryItems {
		items[n] = api.InventoryConsumption{InventoryId: i.InventoryID, Consume: i.Consume.String()}
	}
	limit := nullable.NewNullNullable[int32]()
	if t.OverdueNotifyLimit != nil {
		limit = nullable.NewNullableWithValue(int32(*t.OverdueNotifyLimit))
	}
	return api.StoredRemindTask{Id: t.ID, ChannelId: t.ChannelID, MessageId: toNullable(t.MessageID), Title: t.Title, Description: toNullable(t.Description), IntervalDays: int32(t.IntervalDays), TimeOfDay: t.TimeOfDay, RemindBeforeMinutes: int32(t.RemindBeforeMinutes), StartAt: mapTimestamp(t.StartAt), NextDueAt: mapTimestamp(t.NextDueAt), LastDoneAt: mapNullableTimestamp(t.LastDoneAt), LastRemindDueAt: mapNullableTimestamp(t.LastRemindDueAt), OverdueNotifyCount: int32(t.OverdueNotifyCount), OverdueNotifyLimit: limit, LastOverdueNotifiedAt: mapNullableTimestamp(t.LastOverdueNotifiedAt), IsPaused: t.IsPaused, CreatedAt: mapTimestamp(t.CreatedAt), UpdatedAt: mapTimestamp(t.UpdatedAt), Revision: strconv.FormatInt(t.Revision, 10), Position: int32(t.Position), InventoryItems: items}
}
func mapShortage(s domain.Shortage) api.Shortage {
	return api.Shortage{InventoryId: s.InventoryID, Name: s.Name, Required: s.Required.String(), Available: s.Available.String()}
}
func mapListSnapshot(l domain.List) api.ListSnapshot {
	items := make([]api.StoredListItem, len(l.Items))
	for n, i := range l.Items {
		items[n] = mapListItem(i)
	}
	return api.ListSnapshot{EditVersion: strconv.FormatInt(l.Channel.EditVersion, 10), Items: items}
}
