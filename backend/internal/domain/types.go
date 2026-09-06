package domain

import "time"

// Error describes a business failure without transport status or presentation text.
type Error struct {
	Code                    Code
	Target, Message, Reason string
}

type Code string

const (
	CodeInvalidInput Code = "invalid_input"
	CodeNotFound     Code = "not_found"
	CodeConflict     Code = "conflict"
	CodeShortage     Code = "shortage"
	CodeReferenced   Code = "referenced"
)

const (
	NotificationList     = "list"
	NotificationBefore   = "before"
	NotificationOverdue  = "overdue"
	NotificationProgress = "progress"
)

const ReasonDuplicateName = "duplicate_name"

func DuplicateName(name string) error {
	return &Error{Code: CodeInvalidInput, Target: name, Message: "Duplicate name", Reason: ReasonDuplicateName}
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Message }
func Fail(code Code, target, message string) error {
	return &Error{Code: code, Target: target, Message: message}
}

type ChannelSettings struct {
	ChannelID            string
	MessageID            *string
	ListTitle            string
	OperationLogThreadID *string
}
type ListChannel struct {
	ChannelSettings
	DefaultCategory string
	EditVersion     int64
}
type InventoryChannel struct {
	ChannelSettings
	DefaultCategory string
}
type RemindChannelSettings struct {
	ChannelSettings
	RemindNoticeThreadID, RemindNoticeMessageID, LinkedInventoryChannelID *string
}
type ListItem struct {
	ID, ChannelID, Name string
	Category, Until     *string
	IsCompleted         bool
	LastNotifiedAt      *time.Time
	Position            int
}
type InventoryItem struct {
	EntityID, ID, ChannelID, Name string
	Stock                         Quantity
	Category                      *string
	Position                      int
}
type InventoryConsumption struct {
	EntityID, InventoryID string
	Consume               Quantity
}
type RemindTask struct {
	EntityID, ID, ChannelID     string
	MessageID                   *string
	Title                       string
	Description                 *string
	IntervalDays                int
	TimeOfDay                   string
	RemindBeforeMinutes         int
	StartAt, NextDueAt          time.Time
	LastDoneAt, LastRemindDueAt *time.Time
	OverdueNotifyCount          int
	OverdueNotifyLimit          *int
	LastOverdueNotifiedAt       *time.Time
	IsPaused                    bool
	CreatedAt, UpdatedAt        time.Time
	Revision                    int64
	Position                    int
	InventoryItems              []InventoryConsumption
}
type List struct {
	Channel ListChannel
	Items   []ListItem
}
type InventoryCatalog struct {
	Channel InventoryChannel
	Items   []InventoryItem
}
type Shortage struct {
	InventoryID, Name   string
	Required, Available Quantity
}
