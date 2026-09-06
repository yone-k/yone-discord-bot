package application

import (
	"context"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type TaskDisplay struct {
	Channel   domain.RemindChannelSettings
	Task      domain.RemindTask
	Shortages []domain.Shortage
}
type ListDisplay struct {
	Channel domain.ListChannel
	Items   []domain.ListItem
}
type InventoryDisplay struct {
	Channel domain.InventoryChannel
	Items   []domain.InventoryItem
}
type Initialization struct {
	Lists          []ListDisplay
	Inventories    []InventoryDisplay
	Reminders      []TaskDisplay
	RemindChannels []domain.RemindChannelSettings
}
type NotificationToken struct {
	Kind, ChannelID, ID string
	EvaluatedAt         time.Time
	TargetDueAt         string
	ExpectedRevision    *int64
}
type Notification struct {
	NotificationToken
	List     *ListDisplay
	Item     *domain.ListItem
	Reminder *TaskDisplay
}
type ProgressUpdate struct {
	Kind        string
	Reminder    TaskDisplay
	EvaluatedAt time.Time
}
type NotificationPlan struct {
	EvaluatedAt   time.Time
	Notifications []Notification
	Progress      []ProgressUpdate
}
type NotificationAckResult struct {
	Item *domain.ListItem
	Task *domain.RemindTask
}

// One display operation shares catalogs within its repeatable-read snapshot.
type displayReader struct {
	repository Repository
	catalogs   map[string]*domain.InventoryCatalog
}

func (d *displayReader) catalog(ctx context.Context, id string) (*domain.InventoryCatalog, error) {
	if catalog, ok := d.catalogs[id]; ok {
		return catalog, nil
	}
	catalog, err := getCatalog(ctx, d.repository, id, false)
	if err != nil {
		return nil, err
	}
	if d.catalogs == nil {
		d.catalogs = make(map[string]*domain.InventoryCatalog)
	}
	d.catalogs[id] = catalog
	return catalog, nil
}
func (d *displayReader) task(ctx context.Context, ch domain.RemindChannelSettings, t domain.RemindTask) (TaskDisplay, error) {
	display := TaskDisplay{Channel: ch, Task: t, Shortages: []domain.Shortage{}}
	if len(t.InventoryItems) == 0 {
		return display, nil
	}
	if ch.LinkedInventoryChannelID == nil {
		return display, domain.Fail(domain.CodeNotFound, ch.ChannelID, "Inventory is not linked")
	}
	catalog, err := d.catalog(ctx, *ch.LinkedInventoryChannelID)
	if err != nil {
		return display, err
	}
	display.Shortages = catalog.Shortages(t.InventoryItems)
	return display, nil
}
func (s *Service) GetInitialization(ctx context.Context) (*Initialization, error) {
	return read(s, ctx, func(r Repository) (*Initialization, error) {
		reader := displayReader{repository: r}
		out := &Initialization{Lists: []ListDisplay{}, Inventories: []InventoryDisplay{}, Reminders: []TaskDisplay{}}
		lists, e := r.Lists(ctx)
		if e != nil {
			return nil, e
		}
		for _, ch := range lists {
			l, e := getList(ctx, r, ch.ChannelID, false)
			if e != nil {
				return nil, e
			}
			out.Lists = append(out.Lists, ListDisplay{Channel: l.Channel, Items: l.Items})
		}
		catalogs, e := r.Catalogs(ctx)
		if e != nil {
			return nil, e
		}
		for _, ch := range catalogs {
			c, e := reader.catalog(ctx, ch.ChannelID)
			if e != nil {
				return nil, e
			}
			out.Inventories = append(out.Inventories, InventoryDisplay{Channel: c.Channel, Items: c.Items})
		}
		channels, e := r.RemindChannels(ctx)
		if e != nil {
			return nil, e
		}
		out.RemindChannels = channels
		for _, ch := range channels {
			tasks, e := r.Tasks(ctx, ch.ChannelID, false)
			if e != nil {
				return nil, e
			}
			for _, t := range tasks {
				display, e := reader.task(ctx, ch, t)
				if e != nil {
					return nil, e
				}
				out.Reminders = append(out.Reminders, display)
			}
		}
		return out, nil
	})
}
func (s *Service) GetRelatedTasks(ctx context.Context, inventory string) ([]TaskDisplay, error) {
	return read(s, ctx, func(r Repository) ([]TaskDisplay, error) {
		reader := displayReader{repository: r}
		out := []TaskDisplay{}
		channels, e := r.RemindChannels(ctx)
		if e != nil {
			return nil, e
		}
		for _, ch := range channels {
			if ch.LinkedInventoryChannelID == nil || *ch.LinkedInventoryChannelID != inventory {
				continue
			}
			tasks, e := r.Tasks(ctx, ch.ChannelID, false)
			if e != nil {
				return nil, e
			}
			for _, t := range tasks {
				if len(t.InventoryItems) == 0 || t.MessageID == nil {
					continue
				}
				d, e := reader.task(ctx, ch, t)
				if e != nil {
					return nil, e
				}
				out = append(out, d)
			}
		}
		return out, nil
	})
}
func (s *Service) PollNotifications(ctx context.Context) (*NotificationPlan, error) {
	return read(s, ctx, func(r Repository) (*NotificationPlan, error) {
		reader := displayReader{repository: r}
		now := s.now()
		out := &NotificationPlan{EvaluatedAt: now, Notifications: []Notification{}, Progress: []ProgressUpdate{}}
		lists, e := r.Lists(ctx)
		if e != nil {
			return nil, e
		}
		for _, ch := range lists {
			if ch.OperationLogThreadID == nil {
				continue
			}
			l, e := getList(ctx, r, ch.ChannelID, false)
			if e != nil {
				return nil, e
			}
			for _, item := range l.Items {
				if !domain.ShouldNotifyList(item, now) {
					continue
				}
				d := ListDisplay{Channel: l.Channel, Items: l.Items}
				out.Notifications = append(out.Notifications, Notification{NotificationToken: NotificationToken{Kind: domain.NotificationList, ChannelID: ch.ChannelID, ID: item.ID, EvaluatedAt: now, TargetDueAt: *item.Until}, List: &d, Item: &item})
			}
		}
		channels, e := r.RemindChannels(ctx)
		if e != nil {
			return nil, e
		}
		for _, ch := range channels {
			tasks, e := r.Tasks(ctx, ch.ChannelID, false)
			if e != nil {
				return nil, e
			}
			for _, t := range tasks {
				if t.MessageID == nil || t.IsPaused {
					continue
				}
				kind := ""
				if domain.ShouldSendPreReminder(t, now) {
					kind = domain.NotificationBefore
				} else if domain.ShouldSendOverdue(t, now) {
					kind = domain.NotificationOverdue
				}
				if kind == "" && now.In(domain.Tokyo).Minute() != 0 {
					continue
				}
				d, e := reader.task(ctx, ch, t)
				if e != nil {
					return nil, e
				}
				if kind != "" {
					revision := t.Revision
					out.Notifications = append(out.Notifications, Notification{NotificationToken: NotificationToken{Kind: kind, ChannelID: ch.ChannelID, ID: t.ID, EvaluatedAt: now, TargetDueAt: t.NextDueAt.UTC().Format("2006-01-02T15:04:05.000Z"), ExpectedRevision: &revision}, Reminder: &d})
				} else {
					out.Progress = append(out.Progress, ProgressUpdate{Kind: domain.NotificationProgress, Reminder: d, EvaluatedAt: now})
				}
			}
		}
		return out, nil
	})
}
func (s *Service) AckNotification(ctx context.Context, in NotificationToken) (*NotificationAckResult, error) {
	return write(s, ctx, func(r Repository) (*NotificationAckResult, error) {
		if in.EvaluatedAt.IsZero() || in.EvaluatedAt.Year() < 1 || in.EvaluatedAt.Year() > 9999 {
			return nil, domain.Fail(domain.CodeInvalidInput, "evaluatedAt", "Invalid notification timestamp")
		}
		if in.Kind == domain.NotificationList {
			if in.ExpectedRevision != nil {
				return nil, domain.Fail(domain.CodeInvalidInput, "expectedRevision", "List notifications have no revision")
			}
			l, e := getList(ctx, r, in.ChannelID, true)
			if e != nil {
				return nil, e
			}
			for n := range l.Items {
				item := &l.Items[n]
				if item.ID != in.ID {
					continue
				}
				changed, e := item.MarkNotified(in.TargetDueAt, in.EvaluatedAt)
				if e != nil {
					return nil, e
				}
				if changed {
					if e = r.PutList(ctx, l); e != nil {
						return nil, e
					}
				}
				return &NotificationAckResult{Item: item}, nil
			}
			return nil, domain.Fail(domain.CodeNotFound, in.ID, "List item no longer exists")
		}
		if in.Kind != domain.NotificationBefore && in.Kind != domain.NotificationOverdue {
			return nil, domain.Fail(domain.CodeInvalidInput, "kind", "Unknown notification kind")
		}
		if in.ExpectedRevision == nil {
			return nil, domain.Fail(domain.CodeInvalidInput, "expectedRevision", "Task revision is required")
		}
		due, e := time.Parse(time.RFC3339Nano, in.TargetDueAt)
		if e != nil {
			return nil, domain.Fail(domain.CodeInvalidInput, "targetDueAt", "Invalid task deadline")
		}
		ch, e := getRemind(ctx, r, in.ChannelID, true)
		if e != nil {
			return nil, e
		}
		t, e := getTask(ctx, r, in.ChannelID, in.ID, true)
		if e != nil {
			return nil, e
		}
		if e = t.MarkNotified(*in.ExpectedRevision, due, in.Kind, in.EvaluatedAt); e != nil {
			return nil, e
		}
		if e = r.PutTask(ctx, t, ch.LinkedInventoryChannelID, false); e != nil {
			return nil, e
		}
		return &NotificationAckResult{Task: t}, nil
	})
}
