package domain

import (
	"fmt"
	"regexp"
	"strconv"
	"time"
)

// Tokyo has no DST in the supported modern business calendar; using the fixed
// zone also keeps the runtime independent of an operating-system tzdata file.
var Tokyo = time.FixedZone("Asia/Tokyo", 9*60*60)
var timePattern = regexp.MustCompile(`^([0-9]{1,2}):([0-9]{1,2})$`)

func NormalizeTime(s string) (string, error) {
	m := timePattern.FindStringSubmatch(s)
	if m == nil {
		return "", Fail(CodeInvalidInput, "timeOfDay", "Invalid time")
	}
	h, _ := strconv.Atoi(m[1])
	min, _ := strconv.Atoi(m[2])
	if h > 23 || min > 59 {
		return "", Fail(CodeInvalidInput, "timeOfDay", "Invalid time")
	}
	return fmt.Sprintf("%02d:%02d", h, min), nil
}
func ValidateDate(s string) error {
	t, e := time.Parse("2006-01-02", s)
	if e != nil || t.Format("2006-01-02") != s || t.Year() < 1 {
		return Fail(CodeInvalidInput, "until", "Invalid calendar date")
	}
	return nil
}
func TokyoDate(t time.Time) string { return t.In(Tokyo).Format("2006-01-02") }
func CalculateStartAt(now time.Time, clock string) (time.Time, error) {
	clock, e := NormalizeTime(clock)
	if e != nil {
		return time.Time{}, e
	}
	h, _ := strconv.Atoi(clock[:2])
	m, _ := strconv.Atoi(clock[3:])
	local := now.In(Tokyo)
	return time.Date(local.Year(), local.Month(), local.Day(), h, m, 0, 0, Tokyo).UTC(), nil
}
func CalculateNextDueAt(base time.Time, intervalDays int, clock string, now time.Time) (time.Time, error) {
	if intervalDays < 1 || int64(intervalDays) > 2147483647 {
		return time.Time{}, Fail(CodeInvalidInput, "intervalDays", "Invalid interval")
	}
	start, e := CalculateStartAt(base, clock)
	if e != nil {
		return time.Time{}, e
	}
	// Integer calendar-day arithmetic avoids duration overflow for long periods.
	start = start.In(Tokyo)
	next := start.AddDate(0, 0, intervalDays)
	if !next.After(now) {
		delta := now.Unix()/86400 - start.Unix()/86400
		steps := delta / int64(intervalDays)
		if steps < 1 {
			steps = 1
		}
		next = start.AddDate(0, 0, int(steps)*intervalDays)
		if !next.After(now) {
			next = next.AddDate(0, 0, intervalDays)
		}
	}
	if next.Year() < 1 || next.Year() > 9999 {
		return time.Time{}, Fail(CodeInvalidInput, "nextDueAt", "Next deadline is outside supported calendar")
	}
	return next.UTC(), nil
}
func ShouldSendPreReminder(t RemindTask, now time.Time) bool {
	return !t.IsPaused && !now.Before(t.NextDueAt.Add(-time.Duration(t.RemindBeforeMinutes)*time.Minute)) && !now.After(t.NextDueAt) && (t.LastRemindDueAt == nil || !t.LastRemindDueAt.Equal(t.NextDueAt))
}
func ShouldSendOverdue(t RemindTask, now time.Time) bool {
	return !t.IsPaused && now.After(t.NextDueAt) && (t.OverdueNotifyLimit == nil || t.OverdueNotifyCount < *t.OverdueNotifyLimit) && (t.LastOverdueNotifiedAt == nil || TokyoDate(*t.LastOverdueNotifiedAt) != TokyoDate(now))
}
func ShouldNotifyList(item ListItem, now time.Time) bool {
	return !item.IsCompleted && item.Until != nil && *item.Until == TokyoDate(now) && (item.LastNotifiedAt == nil || TokyoDate(*item.LastNotifiedAt) != TokyoDate(now))
}
func (item *ListItem) MarkNotified(until string, evaluated time.Time) (bool, error) {
	if item.Until == nil || *item.Until != until || item.IsCompleted {
		return false, Fail(CodeConflict, item.ID, "List item has changed")
	}
	if until != TokyoDate(evaluated) {
		return false, Fail(CodeInvalidInput, item.ID, "Notification date does not match")
	}
	if item.LastNotifiedAt != nil && TokyoDate(*item.LastNotifiedAt) == TokyoDate(evaluated) {
		return false, nil
	}
	at := evaluated.UTC().Truncate(time.Millisecond)
	item.LastNotifiedAt = &at
	return true, nil
}
