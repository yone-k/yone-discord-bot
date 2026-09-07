package application

import (
	"context"
	"strings"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func (s *Service) SaveListChannel(ctx context.Context, c domain.ListChannel) (*domain.ListChannel, error) {
	return write(s, ctx, func(r Repository) (*domain.ListChannel, error) {
		if e := validateChannel(c.ChannelSettings); e != nil {
			return nil, e
		}
		if strings.TrimSpace(c.DefaultCategory) == "" {
			return nil, domain.Fail(domain.CodeInvalidInput, "defaultCategory", "Category is required")
		}
		l, e := r.GetList(ctx, c.ChannelID, true)
		if e != nil {
			return nil, e
		}
		if l == nil {
			c.EditVersion = 0
			l = &domain.List{Channel: c, Items: []domain.ListItem{}}
		} else {
			c.MessageID, c.OperationLogThreadID = l.Channel.MessageID, l.Channel.OperationLogThreadID
			if e = l.UpdateSettings(c); e != nil {
				return nil, e
			}
		}
		if e = r.PutList(ctx, l); e != nil {
			return nil, e
		}
		if e = s.reserveBusinessOutput(ctx, r, c.ChannelID, c.ChannelID, OutputListRender, l.Channel.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		return &l.Channel, nil
	})
}
func (s *Service) PatchListChannel(ctx context.Context, id string, p ChannelPatch) (*domain.ListChannel, error) {
	return write(s, ctx, func(r Repository) (*domain.ListChannel, error) {
		l, e := getList(ctx, r, id, true)
		if e != nil {
			return nil, e
		}
		c := l.Channel
		patchChannel(&c.ChannelSettings, p)
		if p.DefaultCategory.Present {
			c.DefaultCategory = p.DefaultCategory.Value
		}
		if e = validateChannel(c.ChannelSettings); e != nil {
			return nil, e
		}
		if strings.TrimSpace(c.DefaultCategory) == "" {
			return nil, domain.Fail(domain.CodeInvalidInput, "defaultCategory", "Category is required")
		}
		if e = l.UpdateSettings(c); e != nil {
			return nil, e
		}
		if e = r.PutList(ctx, l); e != nil {
			return nil, e
		}
		if e = s.reserveBusinessOutput(ctx, r, id, id, OutputListRender, l.Channel.OperationLogThreadID, OperationFacts{}, OutputPayload{}); e != nil {
			return nil, e
		}
		return &l.Channel, nil
	})
}
func (s *Service) DeleteListChannel(ctx context.Context, id string) error {
	return s.store.Write(ctx, func(r Repository) error {
		l, e := getList(ctx, r, id, true)
		if e != nil {
			return e
		}
		if len(l.Items) > 0 {
			return domain.Fail(domain.CodeReferenced, id, "Channel contains items")
		}
		return r.DeleteList(ctx, id)
	})
}
func (s *Service) mutateList(ctx context.Context, id string, fn func(*domain.List) error) (*domain.List, error) {
	return write(s, ctx, func(r Repository) (*domain.List, error) {
		l, e := getList(ctx, r, id, true)
		if e != nil {
			return nil, e
		}
		before := append([]domain.ListItem(nil), l.Items...)
		if e = fn(l); e != nil {
			return nil, e
		}
		if e = r.PutList(ctx, l); e != nil {
			return nil, e
		}
		facts := OperationFacts{}
		if actor, ok := OutputOperationFromContext(ctx); ok && actor.Kind == "EditListModalHandler" {
			facts, e = listOperationFacts(before, l.Items)
			if e != nil {
				return nil, e
			}
		}
		if e = s.reserveBusinessOutput(ctx, r, id, id, OutputListRender, l.Channel.OperationLogThreadID, facts, OutputPayload{}); e != nil {
			return nil, e
		}
		return l, nil
	})
}
func (s *Service) SaveList(ctx context.Context, id string, expected int64, items []domain.ListItem) (*domain.List, error) {
	return s.mutateList(ctx, id, func(l *domain.List) error { return l.Save(expected, items, s.ids.NewID) })
}
func (s *Service) AppendListItem(ctx context.Context, id string, item domain.ListItem) (*domain.ListItem, error) {
	l, e := s.mutateList(ctx, id, func(l *domain.List) error {
		var e error
		item.ID, e = s.ids.NewID()
		if e != nil {
			return e
		}
		return l.Append(item)
	})
	if e != nil {
		return nil, e
	}
	return &l.Items[len(l.Items)-1], nil
}
func (s *Service) UpdateListItem(ctx context.Context, channel, id string, item domain.ListItem) (*domain.ListItem, error) {
	l, e := s.mutateList(ctx, channel, func(l *domain.List) error { return l.Update(id, item) })
	if e != nil {
		return nil, e
	}
	for _, i := range l.Items {
		if i.ID == id {
			return &i, nil
		}
	}
	return nil, domain.Fail(domain.CodeNotFound, id, "Item does not exist")
}
func (s *Service) DeleteListItem(ctx context.Context, channel, id string) (*domain.List, error) {
	return s.mutateList(ctx, channel, func(l *domain.List) error { return l.Delete(id) })
}
func (s *Service) ReorderList(ctx context.Context, channel string, ids []string) (*domain.List, error) {
	return s.mutateList(ctx, channel, func(l *domain.List) error { return l.Reorder(ids) })
}
