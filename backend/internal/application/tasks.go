package application

import (
	"context"
	"strings"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type CreateTaskInput struct {
	Title               string
	Description         *string
	IntervalDays        int
	TimeOfDay           string
	RemindBeforeMinutes int
	InventoryItems      []domain.InventoryConsumption
}
type TaskPatch struct {
	Title               Optional[string]
	Description         Optional[*string]
	IntervalDays        Optional[int]
	TimeOfDay           Optional[string]
	RemindBeforeMinutes Optional[int]
	OverdueNotifyLimit  Optional[*int]
	LastDoneAt          Optional[*time.Time]
	NextDueAt           Optional[time.Time]
}

func (p TaskPatch) IsEmpty() bool {
	return !p.Title.Present && !p.Description.Present &&
		!p.IntervalDays.Present && !p.TimeOfDay.Present && !p.RemindBeforeMinutes.Present &&
		!p.OverdueNotifyLimit.Present && !p.LastDoneAt.Present && !p.NextDueAt.Present
}

type ConsumptionOverride struct {
	Name    string
	Consume *domain.Quantity
}
type RemindInventoryEdit struct {
	Name    string
	Stock   *domain.Quantity
	Consume domain.Quantity
}
type RemindInventoryEditResult struct {
	Task               domain.RemindTask
	InventoryChannelID *string
	StockChanged       bool
}

func (s *Service) Tasks(ctx context.Context, channel string) ([]domain.RemindTask, error) {
	return read(s, ctx, func(r Repository) ([]domain.RemindTask, error) {
		if _, e := getRemind(ctx, r, channel, false); e != nil {
			return nil, e
		}
		return r.Tasks(ctx, channel, false)
	})
}
func (s *Service) GetTask(ctx context.Context, channel, id string) (*domain.RemindTask, error) {
	return read(s, ctx, func(r Repository) (*domain.RemindTask, error) { return getTask(ctx, r, channel, id, false) })
}
func (s *Service) GetTaskByMessage(ctx context.Context, channel, message string) (*domain.RemindTask, error) {
	return read(s, ctx, func(r Repository) (*domain.RemindTask, error) {
		task, err := r.GetTaskByMessage(ctx, channel, message)
		return required(task, err, message)
	})
}
func (s *Service) assignReferences(ctx context.Context, r Repository, ch domain.RemindChannelSettings, refs []domain.InventoryConsumption) ([]domain.InventoryConsumption, error) {
	if e := domain.ValidateConsumption(refs); e != nil {
		return nil, e
	}
	if len(refs) == 0 {
		return []domain.InventoryConsumption{}, nil
	}
	if ch.LinkedInventoryChannelID == nil {
		return nil, domain.Fail(domain.CodeInvalidInput, ch.ChannelID, "Inventory is not linked")
	}
	c, e := getCatalog(ctx, r, *ch.LinkedInventoryChannelID, true)
	if e != nil {
		return nil, e
	}
	available := map[string]bool{}
	for _, i := range c.Items {
		available[i.ID] = true
	}
	out := append([]domain.InventoryConsumption(nil), refs...)
	for n := range out {
		if !available[out[n].InventoryID] {
			return nil, domain.Fail(domain.CodeNotFound, out[n].InventoryID, "Referenced inventory does not exist")
		}
		out[n].EntityID, e = s.ids.NewID()
		if e != nil {
			return nil, e
		}
	}
	return out, nil
}
func (s *Service) CreateTask(ctx context.Context, channel string, in CreateTaskInput) (*domain.RemindTask, error) {
	return write(s, ctx, func(r Repository) (*domain.RemindTask, error) {
		ch, e := getRemind(ctx, r, channel, true)
		if e != nil {
			return nil, e
		}
		tasks, e := r.Tasks(ctx, channel, true)
		if e != nil {
			return nil, e
		}
		now := s.now()
		id, e := s.ids.NewID()
		if e != nil {
			return nil, e
		}
		start, e := domain.CalculateStartAt(now, in.TimeOfDay)
		if e != nil {
			return nil, e
		}
		next, e := domain.CalculateNextDueAt(start, in.IntervalDays, in.TimeOfDay, now)
		if e != nil {
			return nil, e
		}
		position := 0
		for _, t := range tasks {
			if t.Position >= position {
				position = t.Position + 1
			}
		}
		t := &domain.RemindTask{ID: id, EntityID: id, ChannelID: channel, Title: in.Title, Description: in.Description, IntervalDays: in.IntervalDays, TimeOfDay: in.TimeOfDay, RemindBeforeMinutes: in.RemindBeforeMinutes, StartAt: start, NextDueAt: next, CreatedAt: now, UpdatedAt: now, Position: position, InventoryItems: in.InventoryItems}
		if e = t.Validate(); e != nil {
			return nil, e
		}
		t.InventoryItems, e = s.assignReferences(ctx, r, *ch, in.InventoryItems)
		if e != nil {
			return nil, e
		}
		if e = r.PutTask(ctx, t, ch.LinkedInventoryChannelID, true); e != nil {
			return nil, e
		}
		if e = s.reserveBusinessOutput(ctx, r, channel, t.ID, OutputTaskCard, ch.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		return t, nil
	})
}
func (s *Service) mutateTask(ctx context.Context, channel, id string, expected int64, fn func(Repository, *domain.RemindChannelSettings, *domain.RemindTask) error) (*domain.RemindTask, error) {
	return write(s, ctx, func(r Repository) (*domain.RemindTask, error) {
		ch, e := getRemind(ctx, r, channel, true)
		if e != nil {
			return nil, e
		}
		t, e := getTask(ctx, r, channel, id, true)
		if e != nil {
			return nil, e
		}
		if e = domain.CheckRevision(t.Revision, expected); e != nil {
			return nil, e
		}
		if e = fn(r, ch, t); e != nil {
			return nil, e
		}
		if e = t.Validate(); e != nil {
			return nil, e
		}
		if e = r.PutTask(ctx, t, ch.LinkedInventoryChannelID, false); e != nil {
			return nil, e
		}
		if e = s.reserveBusinessOutput(ctx, r, channel, t.ID, OutputTaskCard, ch.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		return t, nil
	})
}
func (s *Service) PatchTask(ctx context.Context, channel, id string, expected int64, p TaskPatch) (*domain.RemindTask, error) {
	if p.IsEmpty() {
		return read(s, ctx, func(r Repository) (*domain.RemindTask, error) {
			t, err := getTask(ctx, r, channel, id, false)
			if err != nil {
				return nil, err
			}
			if err = domain.CheckRevision(t.Revision, expected); err != nil {
				return nil, err
			}
			return t, nil
		})
	}
	return s.mutateTask(ctx, channel, id, expected, func(_ Repository, _ *domain.RemindChannelSettings, t *domain.RemindTask) error {
		if p.Title.Present {
			t.Title = p.Title.Value
		}
		if p.Description.Present {
			t.Description = p.Description.Value
		}
		if p.IntervalDays.Present {
			t.IntervalDays = p.IntervalDays.Value
		}
		if p.TimeOfDay.Present {
			t.TimeOfDay = p.TimeOfDay.Value
			start, e := domain.CalculateStartAt(t.CreatedAt, t.TimeOfDay)
			if e != nil {
				return e
			}
			t.StartAt = start
		}
		if p.RemindBeforeMinutes.Present {
			t.RemindBeforeMinutes = p.RemindBeforeMinutes.Value
		}
		if p.OverdueNotifyLimit.Present {
			t.OverdueNotifyLimit = p.OverdueNotifyLimit.Value
		}
		if p.LastDoneAt.Present {
			t.LastDoneAt = p.LastDoneAt.Value
			if p.LastDoneAt.Value != nil {
				normalized := p.LastDoneAt.Value.UTC().Truncate(time.Millisecond)
				t.LastDoneAt = &normalized
			}
		}
		if p.NextDueAt.Present {
			t.NextDueAt = p.NextDueAt.Value.UTC().Truncate(time.Millisecond)
		}
		if (p.LastDoneAt.Present || p.NextDueAt.Present) && t.LastDoneAt != nil && t.LastDoneAt.After(t.NextDueAt) {
			return domain.Fail(domain.CodeInvalidInput, "lastDoneAt", "Completion date cannot be after the next deadline")
		}
		if p.NextDueAt.Present || p.LastDoneAt.Present && p.LastDoneAt.Value != nil {
			t.LastRemindDueAt = nil
			t.OverdueNotifyCount = 0
			t.LastOverdueNotifiedAt = nil
		}
		var e error
		t.Revision, e = domain.NextVersion(t.Revision)
		t.UpdatedAt = s.now()
		return e
	})
}
func (s *Service) SetTaskPaused(ctx context.Context, channel, id string, expected int64, paused bool) (*domain.RemindTask, error) {
	return s.mutateTask(ctx, channel, id, expected, func(_ Repository, _ *domain.RemindChannelSettings, t *domain.RemindTask) error {
		t.IsPaused = paused
		var e error
		t.Revision, e = domain.NextVersion(t.Revision)
		t.UpdatedAt = s.now()
		return e
	})
}
func (s *Service) DeleteTask(ctx context.Context, channel, id string) error {
	return s.store.Write(ctx, func(r Repository) error {
		ch, e := getRemind(ctx, r, channel, true)
		if e != nil {
			return e
		}
		task, e := getTask(ctx, r, channel, id, true)
		if e != nil {
			return e
		}
		payload := OutputPayload{}
		if task.MessageID != nil {
			payload.MessageID = *task.MessageID
		}
		if e = r.DeleteTask(ctx, channel, id); e != nil {
			return e
		}
		if e = r.DeleteCardView(ctx, channel, CardTask, id); e != nil {
			return e
		}
		return s.reserveBusinessOutput(ctx, r, channel, id, OutputTaskCard, ch.OperationLogThreadID, OperationFacts{}, payload)
	})
}
func (s *Service) ReorderTasks(ctx context.Context, channel string, ids []string) ([]domain.RemindTask, error) {
	return write(s, ctx, func(r Repository) ([]domain.RemindTask, error) {
		ch, e := getRemind(ctx, r, channel, true)
		if e != nil {
			return nil, e
		}
		tasks, e := r.Tasks(ctx, channel, true)
		if e != nil {
			return nil, e
		}
		current := make([]string, len(tasks))
		byID := map[string]domain.RemindTask{}
		for n, t := range tasks {
			current[n] = t.ID
			byID[t.ID] = t
		}
		if e = domain.ValidateReorder(current, ids); e != nil {
			return nil, e
		}
		operationID, e := s.reserveBusinessOperation(ctx, r, channel, ch.OperationLogThreadID, OperationFacts{})
		if e != nil {
			return nil, e
		}
		out := make([]domain.RemindTask, 0, len(ids))
		now := s.now()
		for n, id := range ids {
			t := byID[id]
			t.Position = n
			t.Revision, e = domain.NextVersion(t.Revision)
			if e != nil {
				return nil, e
			}
			t.UpdatedAt = now
			if e = r.PutTask(ctx, &t, ch.LinkedInventoryChannelID, false); e != nil {
				return nil, e
			}
			if e = s.reserveCardOutput(ctx, r, channel, t.ID, OutputTaskCard, operationID, OutputPayload{}); e != nil {
				return nil, e
			}
			out = append(out, t)
		}
		return out, nil
	})
}
func completionOverrides(t domain.RemindTask, c *domain.InventoryCatalog, inputs []ConsumptionOverride) ([]domain.InventoryConsumption, error) {
	out := []domain.InventoryConsumption{}
	seen := map[string]bool{}
	refs := map[string]bool{}
	for _, r := range t.InventoryItems {
		refs[r.InventoryID] = true
	}
	for _, in := range inputs {
		if strings.TrimSpace(in.Name) == "" {
			return nil, domain.Fail(domain.CodeInvalidInput, "name", "Inventory name is required")
		}
		if seen[in.Name] {
			return nil, domain.DuplicateName(in.Name)
		}
		seen[in.Name] = true
		id := ""
		if c != nil {
			for _, i := range c.Items {
				if i.Name == in.Name {
					id = i.ID
					break
				}
			}
		}
		if !refs[id] {
			return nil, domain.Fail(domain.CodeInvalidInput, in.Name, "Unexpected consumption name")
		}
		if in.Consume != nil {
			out = append(out, domain.InventoryConsumption{InventoryID: id, Consume: *in.Consume})
		}
	}
	return out, nil
}
func (s *Service) CompleteTask(ctx context.Context, channel, id string, expected int64, inputs []ConsumptionOverride) (*domain.RemindTask, error) {
	return s.mutateTask(ctx, channel, id, expected, func(r Repository, ch *domain.RemindChannelSettings, t *domain.RemindTask) error {
		var c *domain.InventoryCatalog
		var e error
		if len(t.InventoryItems) > 0 {
			if ch.LinkedInventoryChannelID == nil {
				return domain.Fail(domain.CodeNotFound, channel, "Inventory link is missing")
			}
			c, e = getCatalog(ctx, r, *ch.LinkedInventoryChannelID, true)
			if e != nil {
				return e
			}
		}
		overrides, e := completionOverrides(*t, c, inputs)
		if e != nil {
			return e
		}
		consumption, e := t.ResolveConsumption(overrides)
		if e != nil {
			return e
		}
		if c != nil {
			if shortages := c.Shortages(consumption); len(shortages) > 0 {
				return &OperationError{Cause: domain.Fail(domain.CodeShortage, shortages[0].InventoryID, "Insufficient inventory"), Shortages: shortages}
			}
		}
		if e = t.Complete(expected, s.now(), c, overrides); e != nil {
			return e
		}
		if c != nil {
			if e = r.PutCatalog(ctx, c); e != nil {
				return e
			}
			if e = s.reserveCardOutput(ctx, r, c.Channel.ChannelID, c.Channel.ChannelID, OutputInventoryRender, "", OutputPayload{}); e != nil {
				return e
			}
			return s.reserveRelatedTaskCards(ctx, r, c.Channel.ChannelID)
		}
		return nil
	})
}
