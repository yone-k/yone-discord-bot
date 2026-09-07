package application

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func validateRemind(c domain.RemindChannelSettings) error {
	if e := validateChannel(c.ChannelSettings); e != nil {
		return e
	}
	for _, id := range []*string{c.RemindNoticeThreadID, c.RemindNoticeMessageID, c.LinkedInventoryChannelID} {
		if e := validateID(id); e != nil {
			return e
		}
	}
	return nil
}
func checkLink(ctx context.Context, r Repository, ch *domain.RemindChannelSettings, next *string) error {
	tasks, e := r.Tasks(ctx, ch.ChannelID, true)
	if e != nil {
		return e
	}
	used := map[string]bool{}
	for _, t := range tasks {
		for _, i := range t.InventoryItems {
			used[i.InventoryID] = true
		}
	}
	if next != nil {
		c, e := getCatalog(ctx, r, *next, true)
		if e != nil {
			return e
		}
		for _, i := range c.Items {
			delete(used, i.ID)
		}
	}
	return ch.ChangeInventoryLink(next, len(used) > 0)
}
func (s *Service) SaveRemindChannel(ctx context.Context, c domain.RemindChannelSettings) (*domain.RemindChannelSettings, error) {
	return write(s, ctx, func(r Repository) (*domain.RemindChannelSettings, error) {
		if e := validateRemind(c); e != nil {
			return nil, e
		}
		previous, e := r.GetRemindChannel(ctx, c.ChannelID, true)
		if e != nil {
			return nil, e
		}
		next := c.LinkedInventoryChannelID
		c.LinkedInventoryChannelID = nil
		if previous != nil {
			c.LinkedInventoryChannelID = previous.LinkedInventoryChannelID
			c.MessageID, c.OperationLogThreadID = previous.MessageID, previous.OperationLogThreadID
			c.RemindNoticeMessageID, c.RemindNoticeThreadID = previous.RemindNoticeMessageID, previous.RemindNoticeThreadID
		}
		if e = checkLink(ctx, r, &c, next); e != nil {
			return nil, e
		}
		if e = r.PutRemindChannel(ctx, &c); e != nil {
			return nil, e
		}
		if previous == nil {
			if e = s.reserveThreadEnsure(ctx, r, outputChannel{c.ChannelID, "reminder"}, "reminder_notice", true); e != nil {
				return nil, e
			}
		}
		if e = s.reserveReminderCards(ctx, r, &c); e != nil {
			return nil, e
		}
		return &c, nil
	})
}
func (s *Service) PatchRemindChannel(ctx context.Context, id string, p ChannelPatch) (*domain.RemindChannelSettings, error) {
	return write(s, ctx, func(r Repository) (*domain.RemindChannelSettings, error) {
		c, e := getRemind(ctx, r, id, true)
		if e != nil {
			return nil, e
		}
		patchChannel(&c.ChannelSettings, p)
		if e = validateRemind(*c); e != nil {
			return nil, e
		}
		if e = r.PutRemindChannel(ctx, c); e != nil {
			return nil, e
		}
		if e = s.reserveReminderCards(ctx, r, c); e != nil {
			return nil, e
		}
		return c, nil
	})
}
func (s *Service) LinkInventory(ctx context.Context, id string, next *string) (*domain.RemindChannelSettings, error) {
	return write(s, ctx, func(r Repository) (*domain.RemindChannelSettings, error) {
		if e := validateID(next); e != nil {
			return nil, e
		}
		c, e := getRemind(ctx, r, id, true)
		if e != nil {
			return nil, e
		}
		if e = checkLink(ctx, r, c, next); e != nil {
			return nil, e
		}
		if e = r.PutRemindChannel(ctx, c); e != nil {
			return nil, e
		}
		if e = s.reserveReminderCards(ctx, r, c); e != nil {
			return nil, e
		}
		return c, nil
	})
}
func (s *Service) DeleteRemindChannel(ctx context.Context, id string) error {
	return s.store.Write(ctx, func(r Repository) error {
		_, e := getRemind(ctx, r, id, true)
		if e != nil {
			return e
		}
		tasks, e := r.Tasks(ctx, id, true)
		if e != nil {
			return e
		}
		if len(tasks) > 0 {
			return domain.Fail(domain.CodeReferenced, id, "Channel contains tasks")
		}
		return r.DeleteRemindChannel(ctx, id)
	})
}
