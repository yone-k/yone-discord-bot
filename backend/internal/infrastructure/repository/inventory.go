package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/inventorychannel"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/inventoryitem"
)

func inventoryChannel(v *ent.InventoryChannel) domain.InventoryChannel {
	return domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: v.ID, MessageID: v.MessageID, ListTitle: v.ListTitle, OperationLogThreadID: v.OperationLogThreadID}, DefaultCategory: v.DefaultCategory}
}
func (r *repository) GetInventoryChannel(ctx context.Context, id string) (*domain.InventoryChannel, error) {
	row, err := r.client.InventoryChannel.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	channel := inventoryChannel(row)
	return &channel, nil
}
func (r *repository) Catalogs(ctx context.Context) ([]domain.InventoryChannel, error) {
	rows, e := r.client.InventoryChannel.Query().Order(ent.Asc(inventorychannel.FieldID)).All(ctx)
	if e != nil {
		return nil, e
	}
	out := make([]domain.InventoryChannel, 0, len(rows))
	for _, row := range rows {
		out = append(out, inventoryChannel(row))
	}
	return out, nil
}
func (r *repository) GetCatalog(ctx context.Context, id string, lock bool) (*domain.InventoryCatalog, error) {
	if lock {
		if e := r.lockChannel(ctx, "inventory_channels", id); e != nil {
			return nil, e
		}
	}
	ch, e := r.client.InventoryChannel.Get(ctx, id)
	if ent.IsNotFound(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	if lock {
		if e = r.lockItems(ctx, "inventory_items", id); e != nil {
			return nil, e
		}
	}
	rows, e := r.client.InventoryItem.Query().Where(inventoryitem.ChannelIDEQ(id)).Order(ent.Asc(inventoryitem.FieldPosition)).All(ctx)
	if e != nil {
		return nil, e
	}
	out := &domain.InventoryCatalog{Channel: inventoryChannel(ch), Items: make([]domain.InventoryItem, 0, len(rows))}
	for _, v := range rows {
		q, e := domain.ParseQuantity(v.Stock)
		if e != nil {
			return nil, e
		}
		out.Items = append(out.Items, domain.InventoryItem{EntityID: v.ID.String(), ID: v.LegacyID, ChannelID: v.ChannelID, Name: v.Name, Stock: q, Category: v.Category, Position: v.Position})
	}
	return out, nil
}
func (r *repository) PutCatalog(ctx context.Context, v *domain.InventoryCatalog) error {
	c := v.Channel
	priorChannel, e := r.client.InventoryChannel.Get(ctx, c.ChannelID)
	if e != nil && !ent.IsNotFound(e) {
		return e
	}
	if priorChannel == nil {
		_, e = r.client.InventoryChannel.Create().SetID(c.ChannelID).SetListTitle(c.ListTitle).SetDefaultCategory(c.DefaultCategory).SetNillableMessageID(c.MessageID).SetNillableOperationLogThreadID(c.OperationLogThreadID).Save(ctx)
	} else if priorChannel.ListTitle != c.ListTitle || priorChannel.DefaultCategory != c.DefaultCategory || !equalOptional(priorChannel.MessageID, c.MessageID) || !equalOptional(priorChannel.OperationLogThreadID, c.OperationLogThreadID) {
		update := r.client.InventoryChannel.UpdateOneID(c.ChannelID).SetListTitle(c.ListTitle).SetDefaultCategory(c.DefaultCategory)
		setNullable(c.MessageID, update.SetMessageID, update.ClearMessageID)
		setNullable(c.OperationLogThreadID, update.SetOperationLogThreadID, update.ClearOperationLogThreadID)
		_, e = update.Save(ctx)
	}
	if e != nil {
		return e
	}
	rows, e := r.client.InventoryItem.Query().Where(inventoryitem.ChannelIDEQ(c.ChannelID)).All(ctx)
	if e != nil {
		return e
	}
	old := map[string]*ent.InventoryItem{}
	keep := map[string]bool{}
	for _, i := range v.Items {
		keep[i.ID] = true
	}
	for _, i := range rows {
		old[i.LegacyID] = i
		if !keep[i.LegacyID] {
			if e = r.client.InventoryItem.DeleteOne(i).Exec(ctx); e != nil {
				return e
			}
		}
	}
	// Immediate name uniqueness requires vacating renamed values before swaps.
	for _, i := range v.Items {
		if prior := old[i.ID]; prior != nil && prior.Name != i.Name {
			temporary, e := uuid.NewV7()
			if e != nil {
				return e
			}
			if _, e = r.client.InventoryItem.UpdateOneID(prior.ID).SetName("editing-" + temporary.String()).Save(ctx); e != nil {
				return e
			}
		}
	}
	for _, i := range v.Items {
		uid, e := uuid.Parse(i.EntityID)
		if e != nil {
			return e
		}
		if old[i.ID] == nil {
			_, e = r.client.InventoryItem.Create().SetID(uid).SetLegacyID(i.ID).SetChannelID(c.ChannelID).SetName(i.Name).SetStock(i.Stock.String()).SetNillableCategory(i.Category).SetPosition(i.Position).Save(ctx)
		} else {
			prior := old[i.ID]
			stock, err := domain.ParseQuantity(prior.Stock)
			if err != nil {
				return err
			}
			stockChanged := stock.Compare(i.Stock) != 0
			if prior.ID == uid && prior.Name == i.Name && !stockChanged && equalOptional(prior.Category, i.Category) && prior.Position == i.Position {
				continue
			}
			update := r.client.InventoryItem.UpdateOneID(uid).SetName(i.Name).SetPosition(i.Position)
			if stockChanged {
				update.SetStock(i.Stock.String())
			}
			setNullable(i.Category, update.SetCategory, update.ClearCategory)
			_, e = update.Save(ctx)
		}
		if e != nil {
			return e
		}
	}
	return nil
}
func (r *repository) DeleteCatalog(ctx context.Context, id string) error {
	return r.client.InventoryChannel.DeleteOneID(id).Exec(ctx)
}
