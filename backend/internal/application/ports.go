package application

import (
	"context"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type Clock interface{ Now() time.Time }
type IDGenerator interface{ NewID() (string, error) }

// Store provides one repeatable read snapshot or one atomic write unit. The
// repository passed to the callback must never escape the callback.
type Store interface {
	Read(context.Context, func(Repository) error) error
	Write(context.Context, func(Repository) error) error
}

// Repository exchanges domain aggregates and application-owned output records.
// Locking reads acquire parent channel locks before item locks and retain them
// for the write unit. Outbox writes use that same unit.
type Repository interface {
	OutputQueue
	Lists(context.Context) ([]domain.ListChannel, error)
	GetListChannel(ctx context.Context, channelID string) (*domain.ListChannel, error)
	GetList(ctx context.Context, channelID string, lock bool) (*domain.List, error)
	PutList(context.Context, *domain.List) error
	DeleteList(context.Context, string) error
	Catalogs(context.Context) ([]domain.InventoryChannel, error)
	GetInventoryChannel(ctx context.Context, channelID string) (*domain.InventoryChannel, error)
	GetCatalog(ctx context.Context, channelID string, lock bool) (*domain.InventoryCatalog, error)
	PutCatalog(context.Context, *domain.InventoryCatalog) error
	DeleteCatalog(context.Context, string) error
	RemindChannels(context.Context) ([]domain.RemindChannelSettings, error)
	GetRemindChannel(ctx context.Context, channelID string, lock bool) (*domain.RemindChannelSettings, error)
	PutRemindChannel(context.Context, *domain.RemindChannelSettings) error
	DeleteRemindChannel(context.Context, string) error
	Tasks(ctx context.Context, channelID string, lock bool) ([]domain.RemindTask, error)
	GetTask(ctx context.Context, channelID, taskID string, lock bool) (*domain.RemindTask, error)
	GetTaskByMessage(ctx context.Context, channelID, messageID string) (*domain.RemindTask, error)
	PutTask(ctx context.Context, task *domain.RemindTask, inventoryChannelID *string, replaceInventoryReferences bool) error
	DeleteTask(ctx context.Context, channelID, taskID string) error
	GetNurseryMenu(ctx context.Context, date string) (*domain.NurseryMenu, error)
	NurseryMenus(ctx context.Context, from, to string) ([]domain.NurseryMenu, error)
	PutNurseryMenu(context.Context, domain.NurseryMenu) error
	DeleteNurseryMenu(ctx context.Context, date string) error
	GetNurseryMenuChannel(context.Context) (*string, error)
	PutNurseryMenuChannel(ctx context.Context, channelID string, updatedAt time.Time) error
	// NurseryMenuNoticeExists reports a notice for the date in any channel that
	// is unfinished, delivered, or cancelled with possible delivery evidence.
	NurseryMenuNoticeExists(ctx context.Context, date string) (bool, error)
}

type Service struct {
	store Store
	clock Clock
	ids   IDGenerator
}

func New(store Store, clock Clock, ids IDGenerator) *Service {
	return &Service{store: store, clock: clock, ids: ids}
}
