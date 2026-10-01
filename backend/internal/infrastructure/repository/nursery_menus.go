package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/nurserymenu"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/nurserymenusetting"
)

func mapNurseryMenu(v *ent.NurseryMenu) domain.NurseryMenu {
	return domain.NurseryMenu{ID: v.ID.String(), Date: v.MenuDate.Format(time.DateOnly), Lunch: v.Lunch, Snack: v.Snack, CreatedAt: v.CreatedAt.UTC(), UpdatedAt: v.UpdatedAt.UTC()}
}

func menuDate(date string) (time.Time, error) { return time.Parse(time.DateOnly, date) }

func (r *repository) GetNurseryMenu(ctx context.Context, date string) (*domain.NurseryMenu, error) {
	day, err := menuDate(date)
	if err != nil {
		return nil, err
	}
	v, err := r.client.NurseryMenu.Query().Where(nurserymenu.MenuDateEQ(day)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	menu := mapNurseryMenu(v)
	return &menu, nil
}

func (r *repository) NurseryMenus(ctx context.Context, from, to string) ([]domain.NurseryMenu, error) {
	start, err := menuDate(from)
	if err != nil {
		return nil, err
	}
	end, err := menuDate(to)
	if err != nil {
		return nil, err
	}
	rows, err := r.client.NurseryMenu.Query().Where(nurserymenu.MenuDateGTE(start), nurserymenu.MenuDateLTE(end)).Order(ent.Asc(nurserymenu.FieldMenuDate)).All(ctx)
	if err != nil {
		return nil, err
	}
	menus := make([]domain.NurseryMenu, 0, len(rows))
	for _, v := range rows {
		menus = append(menus, mapNurseryMenu(v))
	}
	return menus, nil
}

// The Application assigns the ID on creation and keeps it when replacing a day.
func (r *repository) PutNurseryMenu(ctx context.Context, menu domain.NurseryMenu) error {
	id, err := uuid.Parse(menu.ID)
	if err != nil {
		return err
	}
	day, err := menuDate(menu.Date)
	if err != nil {
		return err
	}
	exists, err := r.client.NurseryMenu.Query().Where(nurserymenu.IDEQ(id)).Exist(ctx)
	if err != nil {
		return err
	}
	if exists {
		return r.client.NurseryMenu.UpdateOneID(id).SetMenuDate(day).SetLunch(menu.Lunch).SetSnack(menu.Snack).SetCreatedAt(menu.CreatedAt).SetUpdatedAt(menu.UpdatedAt).Exec(ctx)
	}
	return r.client.NurseryMenu.Create().SetID(id).SetMenuDate(day).SetLunch(menu.Lunch).SetSnack(menu.Snack).SetCreatedAt(menu.CreatedAt).SetUpdatedAt(menu.UpdatedAt).Exec(ctx)
}

func (r *repository) DeleteNurseryMenu(ctx context.Context, date string) error {
	day, err := menuDate(date)
	if err != nil {
		return err
	}
	_, err = r.client.NurseryMenu.Delete().Where(nurserymenu.MenuDateEQ(day)).Exec(ctx)
	return err
}

// The only key the settings table admits; a second destination is impossible.
const nurseryMenuSettingKey = "nursery_menu"

func (r *repository) GetNurseryMenuChannel(ctx context.Context) (*string, error) {
	v, err := r.client.NurseryMenuSetting.Get(ctx, nurseryMenuSettingKey)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v.ChannelID, nil
}

func (r *repository) PutNurseryMenuChannel(ctx context.Context, channelID string, updatedAt time.Time) error {
	exists, err := r.client.NurseryMenuSetting.Query().Where(nurserymenusetting.IDEQ(nurseryMenuSettingKey)).Exist(ctx)
	if err != nil {
		return err
	}
	if exists {
		return r.client.NurseryMenuSetting.UpdateOneID(nurseryMenuSettingKey).SetChannelID(channelID).SetUpdatedAt(updatedAt).Exec(ctx)
	}
	return r.client.NurseryMenuSetting.Create().SetID(nurseryMenuSettingKey).SetChannelID(channelID).SetUpdatedAt(updatedAt).Exec(ctx)
}

// Outbox queries use SQL like the rest of the output queue. A cancelled notice
// still counts when any dispatch may have reached Discord.
func (r *repository) NurseryMenuNoticeExists(ctx context.Context, date string) (bool, error) {
	var exists bool
	err := r.tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM output_tasks t WHERE t.kind='nursery_menu_notice' AND t.target_id=$1
		AND (t.state<>'cancelled' OR EXISTS(SELECT 1 FROM output_dispatches d WHERE d.task_id=t.id AND d.outcome IN ('succeeded','unknown'))))`, date).Scan(&exists)
	return exists, err
}
