package application

import (
	"context"
	"strings"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func (s *Service) EditTaskInventory(ctx context.Context, channel, id string, expected int64, items []RemindInventoryEdit) (*RemindInventoryEditResult, error) {
	return write(s, ctx, func(r Repository) (*RemindInventoryEditResult, error) {
		names := map[string]bool{}
		for _, i := range items {
			if strings.TrimSpace(i.Name) == "" {
				return nil, domain.Fail(domain.CodeInvalidInput, "name", "Inventory name is required")
			}
			if names[i.Name] {
				return nil, domain.DuplicateName(i.Name)
			}
			names[i.Name] = true
		}
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
		refs := make([]domain.InventoryConsumption, 0, len(items))
		changed := false
		var c *domain.InventoryCatalog
		if len(items) > 0 {
			if ch.LinkedInventoryChannelID == nil {
				return nil, domain.Fail(domain.CodeInvalidInput, channel, "Inventory is not linked")
			}
			c, e = getCatalog(ctx, r, *ch.LinkedInventoryChannelID, true)
			if e != nil {
				return nil, e
			}
			for _, in := range items {
				index := -1
				for n, i := range c.Items {
					if i.Name == in.Name {
						index = n
						break
					}
				}
				if index < 0 {
					uid, e := s.ids.NewID()
					if e != nil {
						return nil, e
					}
					stock := domain.Quantity{}
					if in.Stock != nil {
						stock = *in.Stock
					}
					if e = c.Append(domain.InventoryItem{ID: uid, EntityID: uid, Name: in.Name, Stock: stock}); e != nil {
						return nil, e
					}
					index = len(c.Items) - 1
					changed = true
				} else if in.Stock != nil && in.Stock.Compare(c.Items[index].Stock) != 0 {
					c.Items[index].Stock = *in.Stock
					changed = true
				}
				inventory := c.Items[index]
				consume := in.Consume
				entityID := ""
				for _, old := range t.InventoryItems {
					if old.InventoryID == inventory.ID {
						entityID = old.EntityID
						if old.Consume.Compare(in.Consume) == 0 {
							consume = old.Consume
						}
						break
					}
				}
				if entityID == "" {
					entityID, e = s.ids.NewID()
					if e != nil {
						return nil, e
					}
				}
				refs = append(refs, domain.InventoryConsumption{EntityID: entityID, InventoryID: inventory.ID, Consume: consume})
			}
		}
		t.InventoryItems = refs
		t.Revision, e = domain.NextVersion(t.Revision)
		if e != nil {
			return nil, e
		}
		t.UpdatedAt = s.now()
		if e = t.Validate(); e != nil {
			return nil, e
		}
		if c != nil && changed {
			if e = r.PutCatalog(ctx, c); e != nil {
				return nil, e
			}
		}
		if e = r.PutTask(ctx, t, ch.LinkedInventoryChannelID, true); e != nil {
			return nil, e
		}
		if c != nil && changed {
			if e = s.reserveCardOutput(ctx, r, c.Channel.ChannelID, c.Channel.ChannelID, OutputInventoryRender, "", OutputPayload{}); e != nil {
				return nil, e
			}
			if e = s.reserveRelatedTaskCards(ctx, r, c.Channel.ChannelID); e != nil {
				return nil, e
			}
		}
		if e = s.reserveBusinessOutput(ctx, r, channel, id, OutputTaskCard, ch.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		return &RemindInventoryEditResult{Task: *t, InventoryChannelID: ch.LinkedInventoryChannelID, StockChanged: changed}, nil
	})
}

func taskShortages(ctx context.Context, r Repository, ch domain.RemindChannelSettings, t domain.RemindTask) ([]domain.Shortage, error) {
	reader := displayReader{repository: r}
	display, err := reader.task(ctx, ch, t)
	return display.Shortages, err
}
func (s *Service) CheckTaskShortage(ctx context.Context, channel, id string) ([]domain.Shortage, error) {
	return read(s, ctx, func(r Repository) ([]domain.Shortage, error) {
		ch, e := getRemind(ctx, r, channel, false)
		if e != nil {
			return nil, e
		}
		t, e := getTask(ctx, r, channel, id, false)
		if e != nil {
			return nil, e
		}
		return taskShortages(ctx, r, *ch, *t)
	})
}
func (s *Service) GetInventoryItem(ctx context.Context, channel, id string) (*domain.InventoryItem, error) {
	c, e := s.GetCatalog(ctx, channel)
	if e != nil {
		return nil, e
	}
	for _, i := range c.Items {
		if i.ID == id {
			return &i, nil
		}
	}
	return nil, domain.Fail(domain.CodeNotFound, id, "Inventory does not exist")
}
func (s *Service) GetInventoryByName(ctx context.Context, channel, name string) (*domain.InventoryItem, error) {
	c, e := s.GetCatalog(ctx, channel)
	if e != nil {
		return nil, e
	}
	for _, i := range c.Items {
		if i.Name == name {
			return &i, nil
		}
	}
	return nil, domain.Fail(domain.CodeNotFound, name, "Inventory does not exist")
}
func (s *Service) UpdateInventoryItem(ctx context.Context, channel, id string, item domain.InventoryItem) (*domain.InventoryItem, error) {
	item.ID = id
	items, e := s.UpdateInventoryItems(ctx, channel, []domain.InventoryItem{item})
	if e != nil {
		return nil, e
	}
	for _, i := range items {
		if i.ID == id {
			return &i, nil
		}
	}
	return nil, domain.Fail(domain.CodeNotFound, id, "Inventory does not exist")
}
