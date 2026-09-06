package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/listchannel"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/listitem"
)

func listChannel(v *ent.ListChannel) domain.ListChannel {
	return domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: v.ID, MessageID: v.MessageID, ListTitle: v.ListTitle, OperationLogThreadID: v.OperationLogThreadID}, DefaultCategory: v.DefaultCategory, EditVersion: v.EditVersion}
}
func (r *repository) GetListChannel(ctx context.Context, id string) (*domain.ListChannel, error) {
	row, err := r.client.ListChannel.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	channel := listChannel(row)
	return &channel, nil
}
func (r *repository) Lists(ctx context.Context) ([]domain.ListChannel, error) {
	rows, e := r.client.ListChannel.Query().Order(ent.Asc(listchannel.FieldID)).All(ctx)
	if e != nil {
		return nil, e
	}
	out := make([]domain.ListChannel, 0, len(rows))
	for _, row := range rows {
		out = append(out, listChannel(row))
	}
	return out, nil
}
func (r *repository) GetList(ctx context.Context, id string, lock bool) (*domain.List, error) {
	if lock {
		if e := r.lockChannel(ctx, "list_channels", id); e != nil {
			return nil, e
		}
	}
	ch, e := r.client.ListChannel.Get(ctx, id)
	if ent.IsNotFound(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	if lock {
		if e = r.lockItems(ctx, "list_items", id); e != nil {
			return nil, e
		}
	}
	rows, e := r.client.ListItem.Query().Where(listitem.ChannelIDEQ(id)).Order(ent.Asc(listitem.FieldPosition)).All(ctx)
	if e != nil {
		return nil, e
	}
	out := &domain.List{Channel: listChannel(ch), Items: make([]domain.ListItem, 0, len(rows))}
	for _, v := range rows {
		var until *string
		if v.Until != nil {
			s := v.Until.Format("2006-01-02")
			until = &s
		}
		out.Items = append(out.Items, domain.ListItem{ID: v.ID.String(), ChannelID: v.ChannelID, Name: v.Name, Category: v.Category, Until: until, IsCompleted: v.IsCompleted, LastNotifiedAt: utcPtr(v.LastNotifiedAt), Position: v.Position})
	}
	return out, nil
}
func (r *repository) PutList(ctx context.Context, v *domain.List) error {
	c := v.Channel
	priorChannel, e := r.client.ListChannel.Get(ctx, c.ChannelID)
	if e != nil && !ent.IsNotFound(e) {
		return e
	}
	if priorChannel == nil {
		_, e = r.client.ListChannel.Create().SetID(c.ChannelID).SetListTitle(c.ListTitle).SetDefaultCategory(c.DefaultCategory).SetEditVersion(c.EditVersion).SetNillableMessageID(c.MessageID).SetNillableOperationLogThreadID(c.OperationLogThreadID).Save(ctx)
	} else if priorChannel.ListTitle != c.ListTitle || priorChannel.DefaultCategory != c.DefaultCategory || priorChannel.EditVersion != c.EditVersion || !equalOptional(priorChannel.MessageID, c.MessageID) || !equalOptional(priorChannel.OperationLogThreadID, c.OperationLogThreadID) {
		update := r.client.ListChannel.UpdateOneID(c.ChannelID).SetListTitle(c.ListTitle).SetDefaultCategory(c.DefaultCategory).SetEditVersion(c.EditVersion)
		setNullable(c.MessageID, update.SetMessageID, update.ClearMessageID)
		setNullable(c.OperationLogThreadID, update.SetOperationLogThreadID, update.ClearOperationLogThreadID)
		_, e = update.Save(ctx)
	}
	if e != nil {
		return e
	}
	rows, e := r.client.ListItem.Query().Where(listitem.ChannelIDEQ(c.ChannelID)).All(ctx)
	if e != nil {
		return e
	}
	old := map[string]*ent.ListItem{}
	keep := map[string]bool{}
	for _, i := range v.Items {
		keep[i.ID] = true
	}
	for _, i := range rows {
		old[i.ID.String()] = i
		if !keep[i.ID.String()] {
			if e = r.client.ListItem.DeleteOne(i).Exec(ctx); e != nil {
				return e
			}
		}
	}
	for _, i := range v.Items {
		uid, e := uuid.Parse(i.ID)
		if e != nil {
			return e
		}
		var until *time.Time
		if i.Until != nil {
			d, e := time.Parse("2006-01-02", *i.Until)
			if e != nil {
				return e
			}
			until = &d
		}
		if old[i.ID] == nil {
			_, e = r.client.ListItem.Create().SetID(uid).SetChannelID(c.ChannelID).SetName(i.Name).SetNillableCategory(i.Category).SetNillableUntil(until).SetIsCompleted(i.IsCompleted).SetNillableLastNotifiedAt(i.LastNotifiedAt).SetPosition(i.Position).Save(ctx)
		} else {
			prior := old[i.ID]
			if prior.Name == i.Name && equalOptional(prior.Category, i.Category) && equalDate(prior.Until, until) && prior.IsCompleted == i.IsCompleted && equalTimestamp(prior.LastNotifiedAt, i.LastNotifiedAt) && prior.Position == i.Position {
				continue
			}
			update := r.client.ListItem.UpdateOneID(uid).SetName(i.Name).SetIsCompleted(i.IsCompleted).SetPosition(i.Position)
			setNullable(i.Category, update.SetCategory, update.ClearCategory)
			setNullable(until, update.SetUntil, update.ClearUntil)
			setNullable(i.LastNotifiedAt, update.SetLastNotifiedAt, update.ClearLastNotifiedAt)
			_, e = update.Save(ctx)
		}
		if e != nil {
			return e
		}
	}
	return nil
}

func equalOptional[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func equalDate(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Format("2006-01-02") == b.Format("2006-01-02")
}

func equalTimestamp(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Round(time.Millisecond).Equal(b.Round(time.Millisecond))
}
func (r *repository) DeleteList(ctx context.Context, id string) error {
	return r.client.ListChannel.DeleteOneID(id).Exec(ctx)
}
