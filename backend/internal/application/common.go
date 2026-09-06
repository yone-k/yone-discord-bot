package application

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func read[T any](s *Service, ctx context.Context, fn func(Repository) (T, error)) (out T, err error) {
	err = s.store.Read(ctx, func(r Repository) error { var e error; out, e = fn(r); return e })
	return
}
func write[T any](s *Service, ctx context.Context, fn func(Repository) (T, error)) (out T, err error) {
	err = s.store.Write(ctx, func(r Repository) error { var e error; out, e = fn(r); return e })
	return
}
func required[T any](v *T, e error, target string) (*T, error) {
	if e != nil {
		return nil, e
	}
	if v == nil {
		return nil, domain.Fail(domain.CodeNotFound, target, "Record does not exist")
	}
	return v, nil
}
func getList(ctx context.Context, r Repository, id string, lock bool) (*domain.List, error) {
	v, e := r.GetList(ctx, id, lock)
	return required(v, e, id)
}
func getCatalog(ctx context.Context, r Repository, id string, lock bool) (*domain.InventoryCatalog, error) {
	v, e := r.GetCatalog(ctx, id, lock)
	return required(v, e, id)
}
func getRemind(ctx context.Context, r Repository, id string, lock bool) (*domain.RemindChannelSettings, error) {
	v, e := r.GetRemindChannel(ctx, id, lock)
	return required(v, e, id)
}
func getTask(ctx context.Context, r Repository, ch, id string, lock bool) (*domain.RemindTask, error) {
	v, e := r.GetTask(ctx, ch, id, lock)
	return required(v, e, id)
}
func (s *Service) now() time.Time { return s.clock.Now().UTC().Truncate(time.Millisecond) }

var discordID = regexp.MustCompile(`^[0-9]+$`)

func validateChannel(c domain.ChannelSettings) error {
	if !discordID.MatchString(c.ChannelID) || strings.TrimSpace(c.ListTitle) == "" {
		return domain.Fail(domain.CodeInvalidInput, c.ChannelID, "Invalid channel settings")
	}
	for _, v := range []*string{c.MessageID, c.OperationLogThreadID} {
		if v != nil && !discordID.MatchString(*v) {
			return domain.Fail(domain.CodeInvalidInput, *v, "Invalid Discord ID")
		}
	}
	return nil
}
func validateID(v *string) error {
	if v != nil && !discordID.MatchString(*v) {
		return domain.Fail(domain.CodeInvalidInput, *v, "Invalid Discord ID")
	}
	return nil
}

type ChannelPatch struct {
	MessageID                                   Optional[*string]
	ListTitle                                   Optional[string]
	OperationLogThreadID                        Optional[*string]
	DefaultCategory                             Optional[string]
	RemindNoticeThreadID, RemindNoticeMessageID Optional[*string]
}

func patchChannel(c *domain.ChannelSettings, p ChannelPatch) {
	if p.MessageID.Present {
		c.MessageID = p.MessageID.Value
	}
	if p.ListTitle.Present {
		c.ListTitle = p.ListTitle.Value
	}
	if p.OperationLogThreadID.Present {
		c.OperationLogThreadID = p.OperationLogThreadID.Value
	}
}
func (s *Service) GetList(ctx context.Context, id string) (*domain.List, error) {
	return read(s, ctx, func(r Repository) (*domain.List, error) { return getList(ctx, r, id, false) })
}
func (s *Service) GetCatalog(ctx context.Context, id string) (*domain.InventoryCatalog, error) {
	return read(s, ctx, func(r Repository) (*domain.InventoryCatalog, error) { return getCatalog(ctx, r, id, false) })
}
func (s *Service) GetListChannel(ctx context.Context, id string) (*domain.ListChannel, error) {
	return read(s, ctx, func(r Repository) (*domain.ListChannel, error) {
		channel, err := r.GetListChannel(ctx, id)
		return required(channel, err, id)
	})
}
func (s *Service) GetInventoryChannel(ctx context.Context, id string) (*domain.InventoryChannel, error) {
	return read(s, ctx, func(r Repository) (*domain.InventoryChannel, error) {
		channel, err := r.GetInventoryChannel(ctx, id)
		return required(channel, err, id)
	})
}
func (s *Service) GetRemindChannel(ctx context.Context, id string) (*domain.RemindChannelSettings, error) {
	return read(s, ctx, func(r Repository) (*domain.RemindChannelSettings, error) { return getRemind(ctx, r, id, false) })
}
func (s *Service) ListChannels(ctx context.Context) ([]domain.ListChannel, error) {
	return read(s, ctx, func(r Repository) ([]domain.ListChannel, error) { return r.Lists(ctx) })
}
func (s *Service) InventoryChannels(ctx context.Context) ([]domain.InventoryChannel, error) {
	return read(s, ctx, func(r Repository) ([]domain.InventoryChannel, error) { return r.Catalogs(ctx) })
}
func (s *Service) RemindChannels(ctx context.Context) ([]domain.RemindChannelSettings, error) {
	return read(s, ctx, func(r Repository) ([]domain.RemindChannelSettings, error) { return r.RemindChannels(ctx) })
}
