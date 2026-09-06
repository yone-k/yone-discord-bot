package domain

import (
	"math"
	"strings"
	"time"
)

func NextVersion(v int64) (int64, error) {
	if v < 0 || v == math.MaxInt64 {
		return 0, Fail(CodeInvalidInput, "revision", "Version cannot be incremented")
	}
	return v + 1, nil
}
func CheckRevision(actual, expected int64) error {
	if actual != expected {
		return Fail(CodeConflict, "revision", "Reload changed data")
	}
	return nil
}
func ValidateConsumption(items []InventoryConsumption) error {
	seen := map[string]bool{}
	for _, i := range items {
		if strings.TrimSpace(i.InventoryID) == "" || seen[i.InventoryID] {
			return Fail(CodeInvalidInput, i.InventoryID, "Empty or duplicate inventory reference")
		}
		seen[i.InventoryID] = true
	}
	return nil
}
func (t RemindTask) Validate() error {
	if strings.TrimSpace(t.ID) == "" || strings.TrimSpace(t.Title) == "" {
		return Fail(CodeInvalidInput, t.ID, "Task ID and title are required")
	}
	normalized, e := NormalizeTime(t.TimeOfDay)
	if e != nil || normalized != t.TimeOfDay {
		return Fail(CodeInvalidInput, "timeOfDay", "Expected HH:mm")
	}
	if t.IntervalDays < 1 || int64(t.IntervalDays) > math.MaxInt32 || t.RemindBeforeMinutes < 0 || t.RemindBeforeMinutes > 10080 || t.OverdueNotifyCount < 0 || int64(t.OverdueNotifyCount) > math.MaxInt32 || (t.OverdueNotifyLimit != nil && (*t.OverdueNotifyLimit < 0 || int64(*t.OverdueNotifyLimit) > math.MaxInt32)) {
		return Fail(CodeInvalidInput, t.ID, "Invalid reminder period or count")
	}
	for _, v := range []time.Time{t.StartAt, t.NextDueAt, t.CreatedAt, t.UpdatedAt} {
		if v.IsZero() || v.Year() < 1 || v.Year() > 9999 {
			return Fail(CodeInvalidInput, t.ID, "Invalid task timestamp")
		}
	}
	for _, v := range []*time.Time{t.LastDoneAt, t.LastRemindDueAt, t.LastOverdueNotifiedAt} {
		if v != nil && (v.IsZero() || v.Year() < 1 || v.Year() > 9999) {
			return Fail(CodeInvalidInput, t.ID, "Invalid task timestamp")
		}
	}
	return ValidateConsumption(t.InventoryItems)
}
func (t RemindTask) ResolveConsumption(overrides []InventoryConsumption) ([]InventoryConsumption, error) {
	if e := ValidateConsumption(overrides); e != nil {
		return nil, e
	}
	if e := ValidateConsumption(t.InventoryItems); e != nil {
		return nil, e
	}
	values := map[string]Quantity{}
	for _, o := range overrides {
		values[o.InventoryID] = o.Consume
	}
	result := make([]InventoryConsumption, 0, len(t.InventoryItems))
	for _, ref := range t.InventoryItems {
		amount, ok := values[ref.InventoryID]
		if !ok {
			if ref.Consume.Compare(Quantity{}) == 0 {
				return nil, Fail(CodeInvalidInput, ref.InventoryID, "Consumption input is required")
			}
			amount = ref.Consume
		}
		delete(values, ref.InventoryID)
		result = append(result, InventoryConsumption{InventoryID: ref.InventoryID, Consume: amount})
	}
	for id := range values {
		return nil, Fail(CodeInvalidInput, id, "Unexpected consumption reference")
	}
	return result, nil
}

// Complete mutates both aggregates only after every precondition succeeds.
// The application persists both in the same locked transaction.
func (t *RemindTask) Complete(expected int64, now time.Time, catalog *InventoryCatalog, overrides []InventoryConsumption) error {
	if e := CheckRevision(t.Revision, expected); e != nil {
		return e
	}
	version, e := NextVersion(t.Revision)
	if e != nil {
		return e
	}
	consumption, e := t.ResolveConsumption(overrides)
	if e != nil {
		return e
	}
	now = now.UTC().Truncate(time.Millisecond)
	next, e := CalculateNextDueAt(now, t.IntervalDays, t.TimeOfDay, now)
	if e != nil {
		return e
	}
	if len(consumption) > 0 {
		if catalog == nil {
			return Fail(CodeNotFound, t.ID, "Inventory link is missing")
		}
		if e = catalog.Consume(consumption); e != nil {
			return e
		}
	}
	t.LastDoneAt = &now
	t.NextDueAt = next
	t.LastRemindDueAt = nil
	t.OverdueNotifyCount = 0
	t.LastOverdueNotifiedAt = nil
	t.UpdatedAt = now
	t.Revision = version
	return nil
}
func (t *RemindTask) MarkNotified(expected int64, due time.Time, kind string, evaluated time.Time) error {
	if e := CheckRevision(t.Revision, expected); e != nil {
		return e
	}
	if !t.NextDueAt.Equal(due) {
		return Fail(CodeConflict, t.ID, "Deadline has changed")
	}
	version, e := NextVersion(t.Revision)
	if e != nil {
		return e
	}
	evaluated = evaluated.UTC().Truncate(time.Millisecond)
	switch kind {
	case NotificationBefore:
		if !ShouldSendPreReminder(*t, evaluated) {
			return Fail(CodeConflict, t.ID, "Notification no longer eligible")
		}
		copy := t.NextDueAt
		t.LastRemindDueAt = &copy
	case NotificationOverdue:
		if !ShouldSendOverdue(*t, evaluated) {
			return Fail(CodeConflict, t.ID, "Notification no longer eligible")
		}
		if t.OverdueNotifyCount == math.MaxInt32 {
			return Fail(CodeInvalidInput, t.ID, "Notification count overflow")
		}
		t.LastOverdueNotifiedAt = &evaluated
		t.OverdueNotifyCount++
	default:
		return Fail(CodeInvalidInput, "kind", "Unknown notification kind")
	}
	t.Revision = version
	t.UpdatedAt = evaluated
	return nil
}

// ChangeInventoryLink requires the caller to check references against the target
// catalog. Existing references may survive a relink when all business IDs exist
// in the target; only losing references is forbidden.
func (c *RemindChannelSettings) ChangeInventoryLink(next *string, losesReferences bool) error {
	if sameString(c.LinkedInventoryChannelID, next) {
		return nil
	}
	if losesReferences {
		return Fail(CodeReferenced, c.ChannelID, "Inventory link is referenced")
	}
	c.LinkedInventoryChannelID = next
	return nil
}
