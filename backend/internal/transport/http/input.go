package httptransport

import (
	"github.com/oapi-codegen/nullable"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
	"time"
)

func optionalInt(v *int32) application.Optional[int] {
	if v == nil {
		return application.Optional[int]{}
	}
	return application.Some(int(*v))
}
func inputTaskPatch(v api.TaskPatch) (application.TaskPatch, error) {
	p := application.TaskPatch{
		MessageID: optionalNullable(v.MessageId), Title: optionalValue(v.Title), Description: optionalNullable(v.Description),
		IntervalDays: optionalInt(v.IntervalDays), TimeOfDay: optionalValue(v.TimeOfDay), RemindBeforeMinutes: optionalInt(v.RemindBeforeMinutes),
	}
	if v.OverdueNotifyLimit.IsSpecified() {
		var limit *int
		if i := fromNullable(v.OverdueNotifyLimit); i != nil {
			n := int(*i)
			limit = &n
		}
		p.OverdueNotifyLimit = application.Some(limit)
	}
	if v.LastDoneAt.IsSpecified() {
		var stamp *time.Time
		if str := fromNullable(v.LastDoneAt); str != nil {
			t, e := parseTimestamp(*str)
			if e != nil {
				return p, domain.Fail("invalid_input", "lastDoneAt", "Invalid timestamp")
			}
			stamp = &t
		}
		p.LastDoneAt = application.Some(stamp)
	}
	if v.NextDueAt != nil {
		t, e := parseTimestamp(*v.NextDueAt)
		if e != nil {
			return p, domain.Fail("invalid_input", "nextDueAt", "Invalid timestamp")
		}
		p.NextDueAt = application.Some(t)
	}
	return p, nil
}
func inputConsumptions(values []api.InventoryConsumption) ([]domain.InventoryConsumption, error) {
	out := make([]domain.InventoryConsumption, len(values))
	for n, v := range values {
		q, e := domain.ParseQuantity(v.Consume)
		if e != nil {
			return nil, e
		}
		out[n] = domain.InventoryConsumption{InventoryID: v.InventoryId, Consume: q}
	}
	return out, nil
}
func inputOverrides(values *[]api.ConsumptionOverride) ([]application.ConsumptionOverride, error) {
	if values == nil {
		return nil, nil
	}
	out := make([]application.ConsumptionOverride, len(*values))
	for n, v := range *values {
		var quantity *domain.Quantity
		if str := fromNullable(v.Consume); str != nil {
			q, e := domain.ParseQuantity(*str)
			if e != nil {
				return nil, e
			}
			quantity = &q
		}
		out[n] = application.ConsumptionOverride{Name: v.Name, Consume: quantity}
	}
	return out, nil
}
func inputInventoryEdits(values []api.RemindInventoryEdit) ([]application.RemindInventoryEdit, error) {
	out := make([]application.RemindInventoryEdit, len(values))
	for n, v := range values {
		q, e := domain.ParseQuantity(v.Consume)
		if e != nil {
			return nil, e
		}
		var stock *domain.Quantity
		if v.Stock != nil {
			s, e := domain.ParseQuantity(*v.Stock)
			if e != nil {
				return nil, e
			}
			stock = &s
		}
		out[n] = application.RemindInventoryEdit{Name: v.Name, Consume: q, Stock: stock}
	}
	return out, nil
}

func optionalValue[T any](v *T) application.Optional[T] {
	if v == nil {
		return application.Optional[T]{}
	}
	return application.Some(*v)
}
func optionalNullable[T any](v nullable.Nullable[T]) application.Optional[*T] {
	if !v.IsSpecified() {
		return application.Optional[*T]{}
	}
	return application.Some(fromNullable(v))
}
func inputListItem(v api.ListEditItem) domain.ListItem {
	return domain.ListItem{Name: v.Name, Category: fromNullable(v.Category), Until: fromNullable(v.Until), IsCompleted: v.IsCompleted}
}
func inputInventoryItem(id string, v api.InventoryItemInput) (domain.InventoryItem, error) {
	stock, e := domain.ParseQuantity(v.Stock)
	if e != nil {
		return domain.InventoryItem{}, e
	}
	return domain.InventoryItem{ID: id, Name: v.Name, Stock: stock, Category: fromNullable(v.Category)}, nil
}
func inputInventoryItems(items []api.InventoryEditItem) ([]domain.InventoryItem, error) {
	out := make([]domain.InventoryItem, len(items))
	for n, v := range items {
		item, e := inputInventoryItem(v.Id, api.InventoryItemInput{Name: v.Name, Stock: v.Stock, Category: v.Category})
		if e != nil {
			return nil, e
		}
		out[n] = item
	}
	return out, nil
}
func inputApplyInventoryItems(items []api.ApplyInventoryItem) ([]domain.InventoryItem, error) {
	out := make([]domain.InventoryItem, len(items))
	for n, v := range items {
		id := ""
		if v.Id != nil {
			id = *v.Id
		}
		item, e := inputInventoryItem(id, api.InventoryItemInput{Name: v.Name, Stock: v.Stock, Category: v.Category})
		if e != nil {
			return nil, e
		}
		out[n] = item
	}
	return out, nil
}
func requireChannel(path, body string) error {
	if path != body {
		return domain.Fail("invalid_input", "channelId", "Path and body channel IDs must match")
	}
	return nil
}
func mapSlice[A, B any](values []A, convert func(A) B) []B {
	out := make([]B, len(values))
	for n, v := range values {
		out[n] = convert(v)
	}
	return out
}
