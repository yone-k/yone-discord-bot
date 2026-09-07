package application

import (
	"context"
	"errors"
	"strings"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func (s *Service) SaveInventoryChannel(ctx context.Context, c domain.InventoryChannel) (*domain.InventoryChannel, error) {
	return write(s, ctx, func(r Repository) (*domain.InventoryChannel, error) {
		if e := validateChannel(c.ChannelSettings); e != nil {
			return nil, e
		}
		if strings.TrimSpace(c.DefaultCategory) == "" {
			return nil, domain.Fail(domain.CodeInvalidInput, "defaultCategory", "Category is required")
		}
		catalog, e := r.GetCatalog(ctx, c.ChannelID, true)
		if e != nil {
			return nil, e
		}
		if catalog == nil {
			catalog = &domain.InventoryCatalog{Items: []domain.InventoryItem{}}
		} else {
			c.MessageID, c.OperationLogThreadID = catalog.Channel.MessageID, catalog.Channel.OperationLogThreadID
		}
		catalog.Channel = c
		if e = r.PutCatalog(ctx, catalog); e != nil {
			return nil, e
		}
		if e = s.reserveBusinessOutput(ctx, r, c.ChannelID, c.ChannelID, OutputInventoryRender, catalog.Channel.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		return &catalog.Channel, nil
	})
}
func (s *Service) PatchInventoryChannel(ctx context.Context, id string, p ChannelPatch) (*domain.InventoryChannel, error) {
	return write(s, ctx, func(r Repository) (*domain.InventoryChannel, error) {
		c, e := getCatalog(ctx, r, id, true)
		if e != nil {
			return nil, e
		}
		patchChannel(&c.Channel.ChannelSettings, p)
		if p.DefaultCategory.Present {
			c.Channel.DefaultCategory = p.DefaultCategory.Value
		}
		if e = validateChannel(c.Channel.ChannelSettings); e != nil {
			return nil, e
		}
		if strings.TrimSpace(c.Channel.DefaultCategory) == "" {
			return nil, domain.Fail(domain.CodeInvalidInput, "defaultCategory", "Category is required")
		}
		if e = r.PutCatalog(ctx, c); e != nil {
			return nil, e
		}
		if e = s.reserveBusinessOutput(ctx, r, id, id, OutputInventoryRender, c.Channel.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		return &c.Channel, nil
	})
}
func (s *Service) DeleteInventoryChannel(ctx context.Context, id string) error {
	return s.store.Write(ctx, func(r Repository) error {
		c, e := getCatalog(ctx, r, id, true)
		if e != nil {
			return e
		}
		channels, e := r.RemindChannels(ctx)
		if e != nil {
			return e
		}
		for _, ch := range channels {
			if ch.LinkedInventoryChannelID != nil && *ch.LinkedInventoryChannelID == id {
				return domain.Fail(domain.CodeReferenced, id, "Channel is linked")
			}
		}
		if len(c.Items) > 0 {
			return domain.Fail(domain.CodeReferenced, id, "Channel contains items")
		}
		return r.DeleteCatalog(ctx, id)
	})
}
func (s *Service) mutateCatalog(ctx context.Context, id string, fn func(Repository, *domain.InventoryCatalog) error) (*domain.InventoryCatalog, error) {
	return write(s, ctx, func(r Repository) (*domain.InventoryCatalog, error) {
		c, e := getCatalog(ctx, r, id, true)
		if e != nil {
			return nil, e
		}
		if e = fn(r, c); e != nil {
			return nil, e
		}
		if e = r.PutCatalog(ctx, c); e != nil {
			return nil, e
		}
		if e = s.reserveBusinessOutput(ctx, r, id, id, OutputInventoryRender, c.Channel.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		if e = s.reserveRelatedTaskCards(ctx, r, id); e != nil {
			return nil, e
		}
		return c, nil
	})
}
func (s *Service) AppendInventoryItem(ctx context.Context, id string, item domain.InventoryItem) (*domain.InventoryItem, error) {
	c, e := s.mutateCatalog(ctx, id, func(_ Repository, c *domain.InventoryCatalog) error {
		var e error
		item.ID, e = s.ids.NewID()
		if e != nil {
			return e
		}
		item.EntityID = item.ID
		return c.Append(item)
	})
	if e != nil {
		return nil, e
	}
	return &c.Items[len(c.Items)-1], nil
}

// AppendInventoryItems treats the submitted modal as one operation. Duplicate
// names retain their stock and are reported in input order; other failures roll
// back the batch together with its operation record and rendering reservation.
func (s *Service) AppendInventoryItems(ctx context.Context, channel string, items []domain.InventoryItem) ([]string, error) {
	if len(items) == 0 {
		return nil, domain.Fail(domain.CodeInvalidInput, "items", "Items are required")
	}
	skipped := []string{}
	_, err := s.mutateCatalog(ctx, channel, func(_ Repository, catalog *domain.InventoryCatalog) error {
		for _, item := range items {
			id, err := s.ids.NewID()
			if err != nil {
				return err
			}
			item.ID, item.EntityID = id, id
			if err := catalog.Append(item); err != nil {
				var failure *domain.Error
				if errors.As(err, &failure) && failure.Code == domain.CodeInvalidInput && failure.Reason == domain.ReasonDuplicateName {
					skipped = append(skipped, item.Name)
					continue
				}
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return skipped, nil
}
func (s *Service) UpdateInventoryItems(ctx context.Context, id string, items []domain.InventoryItem) ([]domain.InventoryItem, error) {
	c, e := s.mutateCatalog(ctx, id, func(_ Repository, c *domain.InventoryCatalog) error { return c.Update(items) })
	if e != nil {
		return nil, e
	}
	return c.Items, nil
}
func references(ctx context.Context, r Repository, channel string) (map[string]bool, []domain.RemindTask, error) {
	channels, e := r.RemindChannels(ctx)
	if e != nil {
		return nil, nil, e
	}
	used := map[string]bool{}
	tasks := []domain.RemindTask{}
	for _, ch := range channels {
		if ch.LinkedInventoryChannelID == nil || *ch.LinkedInventoryChannelID != channel {
			continue
		}
		rows, e := r.Tasks(ctx, ch.ChannelID, false)
		if e != nil {
			return nil, nil, e
		}
		for _, task := range rows {
			if len(task.InventoryItems) > 0 {
				tasks = append(tasks, task)
			}
			for _, ref := range task.InventoryItems {
				used[ref.InventoryID] = true
			}
		}
	}
	return used, tasks, nil
}
func (s *Service) ApplyInventory(ctx context.Context, id string, expected, items []domain.InventoryItem) ([]domain.InventoryItem, error) {
	c, e := s.mutateCatalog(ctx, id, func(r Repository, c *domain.InventoryCatalog) error {
		used, tasks, e := references(ctx, r, id)
		if e != nil {
			return e
		}
		items = append([]domain.InventoryItem(nil), items...)
		existing := map[string]bool{}
		for _, i := range c.Items {
			existing[i.ID] = true
		}
		for n := range items {
			if items[n].ID == "" {
				items[n].ID, e = s.ids.NewID()
				if e != nil {
					return e
				}
				items[n].EntityID = items[n].ID
			} else if !existing[items[n].ID] {
				return domain.Fail(domain.CodeNotFound, items[n].ID, "Unknown inventory ID")
			}
		}
		e = c.Apply(expected, items, used)
		var failure *domain.Error
		if errors.As(e, &failure) && failure.Code == domain.CodeReferenced {
			return &OperationError{Cause: e, References: tasks}
		}
		return e
	})
	if e != nil {
		return nil, e
	}
	return c.Items, nil
}
func (s *Service) DeleteInventoryItem(ctx context.Context, channel, id string) ([]domain.InventoryItem, error) {
	c, e := s.mutateCatalog(ctx, channel, func(r Repository, c *domain.InventoryCatalog) error {
		used, tasks, e := references(ctx, r, channel)
		if e != nil {
			return e
		}
		e = c.Delete(id, used[id])
		var failure *domain.Error
		if errors.As(e, &failure) && failure.Code == domain.CodeReferenced {
			matching := []domain.RemindTask{}
			for _, task := range tasks {
				for _, ref := range task.InventoryItems {
					if ref.InventoryID == id {
						matching = append(matching, task)
						break
					}
				}
			}
			return &OperationError{Cause: e, References: matching}
		}
		if e != nil {
			return e
		}
		_, e = r.PutCardView(ctx, CardView{ChannelID: channel, TargetKind: CardInventory, TargetID: channel, Mode: CardNormal})
		return e
	})
	if e != nil {
		return nil, e
	}
	return c.Items, nil
}
func (s *Service) ReorderInventory(ctx context.Context, channel string, ids []string) ([]domain.InventoryItem, error) {
	c, e := s.mutateCatalog(ctx, channel, func(_ Repository, c *domain.InventoryCatalog) error { return c.Reorder(ids) })
	if e != nil {
		return nil, e
	}
	return c.Items, nil
}
func (s *Service) ResolveInventory(ctx context.Context, channel, name string) (*domain.InventoryItem, error) {
	return write(s, ctx, func(r Repository) (*domain.InventoryItem, error) {
		c, e := getCatalog(ctx, r, channel, true)
		if e != nil {
			return nil, e
		}
		for _, i := range c.Items {
			if i.Name == name {
				return &i, nil
			}
		}
		id, e := s.ids.NewID()
		if e != nil {
			return nil, e
		}
		if e = c.Append(domain.InventoryItem{ID: id, EntityID: id, Name: name}); e != nil {
			return nil, e
		}
		if e = r.PutCatalog(ctx, c); e != nil {
			return nil, e
		}
		if e = s.reserveBusinessOutput(ctx, r, channel, channel, OutputInventoryRender, c.Channel.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		if e = s.reserveRelatedTaskCards(ctx, r, channel); e != nil {
			return nil, e
		}
		return &c.Items[len(c.Items)-1], nil
	})
}
func (s *Service) InventoryReferences(ctx context.Context, channel, id string) ([]domain.RemindTask, error) {
	return read(s, ctx, func(r Repository) ([]domain.RemindTask, error) {
		_, tasks, e := references(ctx, r, channel)
		if e != nil {
			return nil, e
		}
		out := []domain.RemindTask{}
		for _, t := range tasks {
			for _, ref := range t.InventoryItems {
				if ref.InventoryID == id {
					out = append(out, t)
					break
				}
			}
		}
		return out, nil
	})
}
func (s *Service) LinkedReminders(ctx context.Context, id string) ([]domain.RemindChannelSettings, error) {
	return read(s, ctx, func(r Repository) ([]domain.RemindChannelSettings, error) {
		channels, e := r.RemindChannels(ctx)
		if e != nil {
			return nil, e
		}
		out := []domain.RemindChannelSettings{}
		for _, ch := range channels {
			if ch.LinkedInventoryChannelID != nil && *ch.LinkedInventoryChannelID == id {
				out = append(out, ch)
			}
		}
		return out, nil
	})
}
