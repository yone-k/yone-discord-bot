package repository

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/remindchannel"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/remindtask"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/ent/remindtaskinventoryitem"
)

func remindChannel(v *ent.RemindChannel) domain.RemindChannelSettings {
	return domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: v.ID, MessageID: v.MessageID, ListTitle: v.ListTitle, OperationLogThreadID: v.OperationLogThreadID}, RemindNoticeThreadID: v.RemindNoticeThreadID, RemindNoticeMessageID: v.RemindNoticeMessageID, LinkedInventoryChannelID: v.LinkedInventoryChannelID}
}
func (r *repository) RemindChannels(ctx context.Context) ([]domain.RemindChannelSettings, error) {
	rows, e := r.client.RemindChannel.Query().Order(ent.Asc(remindchannel.FieldID)).All(ctx)
	if e != nil {
		return nil, e
	}
	out := make([]domain.RemindChannelSettings, 0, len(rows))
	for _, v := range rows {
		out = append(out, remindChannel(v))
	}
	return out, nil
}
func (r *repository) GetRemindChannel(ctx context.Context, id string, lock bool) (*domain.RemindChannelSettings, error) {
	if lock {
		if e := r.lockChannel(ctx, "remind_channels", id); e != nil {
			return nil, e
		}
	}
	v, e := r.client.RemindChannel.Get(ctx, id)
	if ent.IsNotFound(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	out := remindChannel(v)
	return &out, nil
}
func (r *repository) PutRemindChannel(ctx context.Context, c *domain.RemindChannelSettings) error {
	exists, e := r.client.RemindChannel.Query().Where(remindchannel.IDEQ(c.ChannelID)).Exist(ctx)
	if e != nil {
		return e
	}
	if !exists {
		_, e = r.client.RemindChannel.Create().SetID(c.ChannelID).SetListTitle(c.ListTitle).SetNillableMessageID(c.MessageID).SetNillableOperationLogThreadID(c.OperationLogThreadID).SetNillableRemindNoticeThreadID(c.RemindNoticeThreadID).SetNillableRemindNoticeMessageID(c.RemindNoticeMessageID).SetNillableLinkedInventoryChannelID(c.LinkedInventoryChannelID).Save(ctx)
	} else {
		update := r.client.RemindChannel.UpdateOneID(c.ChannelID).SetListTitle(c.ListTitle)
		setNullable(c.MessageID, update.SetMessageID, update.ClearMessageID)
		setNullable(c.OperationLogThreadID, update.SetOperationLogThreadID, update.ClearOperationLogThreadID)
		setNullable(c.RemindNoticeThreadID, update.SetRemindNoticeThreadID, update.ClearRemindNoticeThreadID)
		setNullable(c.RemindNoticeMessageID, update.SetRemindNoticeMessageID, update.ClearRemindNoticeMessageID)
		setNullable(c.LinkedInventoryChannelID, update.SetLinkedInventoryChannelID, update.ClearLinkedInventoryChannelID)
		_, e = update.Save(ctx)
	}
	return e
}
func (r *repository) DeleteRemindChannel(ctx context.Context, id string) error {
	return r.client.RemindChannel.DeleteOneID(id).Exec(ctx)
}
func (r *repository) Tasks(ctx context.Context, channel string, lock bool) ([]domain.RemindTask, error) {
	if lock {
		if e := r.lockItems(ctx, "remind_tasks", channel); e != nil {
			return nil, e
		}
	}
	rows, e := r.client.RemindTask.Query().Where(remindtask.ChannelIDEQ(channel)).Order(ent.Asc(remindtask.FieldPosition)).All(ctx)
	if e != nil {
		return nil, e
	}
	out := make([]domain.RemindTask, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	refs, e := r.client.RemindTaskInventoryItem.Query().Where(remindtaskinventoryitem.TaskChannelIDEQ(channel)).Order(ent.Asc(remindtaskinventoryitem.FieldPosition)).All(ctx)
	if e != nil {
		return nil, e
	}
	byTask := make(map[string][]*ent.RemindTaskInventoryItem)
	for _, ref := range refs {
		byTask[ref.TaskID] = append(byTask[ref.TaskID], ref)
	}
	for _, v := range rows {
		task, e := mapTask(v, byTask[v.LegacyID])
		if e != nil {
			return nil, e
		}
		out = append(out, *task)
	}
	return out, nil
}
func (r *repository) GetTask(ctx context.Context, channel, id string, lock bool) (*domain.RemindTask, error) {
	if lock {
		rows, e := r.tx.QueryContext(ctx, "SELECT id FROM remind_tasks WHERE channel_id=$1 AND id=$2 FOR UPDATE", channel, id)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var ignored string
			if e = rows.Scan(&ignored); e != nil {
				rows.Close()
				return nil, e
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	return r.readTask(ctx, r.client.RemindTask.Query().Where(remindtask.ChannelIDEQ(channel), remindtask.LegacyIDEQ(id)))
}

func (r *repository) GetTaskByMessage(ctx context.Context, channel, message string) (*domain.RemindTask, error) {
	return r.readTask(ctx, r.client.RemindTask.Query().Where(remindtask.ChannelIDEQ(channel), remindtask.MessageIDEQ(message)))
}

// readTask shares the single-task lookup and ordered reference mapping for both
// the business-ID and Discord-message-ID entry points.
func (r *repository) readTask(ctx context.Context, query *ent.RemindTaskQuery) (*domain.RemindTask, error) {
	v, e := query.Only(ctx)
	if ent.IsNotFound(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	refs, e := r.client.RemindTaskInventoryItem.Query().Where(remindtaskinventoryitem.TaskChannelIDEQ(v.ChannelID), remindtaskinventoryitem.TaskIDEQ(v.LegacyID)).Order(ent.Asc(remindtaskinventoryitem.FieldPosition)).All(ctx)
	if e != nil {
		return nil, e
	}
	return mapTask(v, refs)
}

// mapTask only converts persistence values; callers load ordered references in
// one query for either a channel or an individual task.
func mapTask(v *ent.RemindTask, refs []*ent.RemindTaskInventoryItem) (*domain.RemindTask, error) {
	out := &domain.RemindTask{EntityID: v.ID.String(), ID: v.LegacyID, ChannelID: v.ChannelID, MessageID: v.MessageID, Title: v.Title, Description: v.Description, IntervalDays: v.IntervalDays, TimeOfDay: strings.TrimSuffix(v.TimeOfDay, ":00"), RemindBeforeMinutes: v.RemindBeforeMinutes, StartAt: v.StartAt.UTC(), NextDueAt: v.NextDueAt.UTC(), LastDoneAt: utcPtr(v.LastDoneAt), LastRemindDueAt: utcPtr(v.LastRemindDueAt), OverdueNotifyCount: v.OverdueNotifyCount, OverdueNotifyLimit: v.OverdueNotifyLimit, LastOverdueNotifiedAt: utcPtr(v.LastOverdueNotifiedAt), IsPaused: v.IsPaused, CreatedAt: v.CreatedAt.UTC(), UpdatedAt: v.UpdatedAt.UTC(), Revision: v.Revision, Position: v.Position, InventoryItems: []domain.InventoryConsumption{}}
	for _, ref := range refs {
		q, e := domain.ParseQuantity(ref.Consume)
		if e != nil {
			return nil, e
		}
		out.InventoryItems = append(out.InventoryItems, domain.InventoryConsumption{EntityID: ref.ID.String(), InventoryID: ref.InventoryID, Consume: q})
	}
	return out, nil
}
func (r *repository) PutTask(ctx context.Context, t *domain.RemindTask, inventoryChannel *string, replace bool) error {
	uid, e := uuid.Parse(t.EntityID)
	if e != nil {
		return e
	}
	exists, e := r.client.RemindTask.Query().Where(remindtask.IDEQ(uid)).Exist(ctx)
	if e != nil {
		return e
	}
	if !exists {
		_, e = r.client.RemindTask.Create().SetID(uid).SetLegacyID(t.ID).SetChannelID(t.ChannelID).SetNillableMessageID(t.MessageID).SetTitle(t.Title).SetNillableDescription(t.Description).SetIntervalDays(t.IntervalDays).SetTimeOfDay(t.TimeOfDay).SetRemindBeforeMinutes(t.RemindBeforeMinutes).SetStartAt(t.StartAt).SetNextDueAt(t.NextDueAt).SetNillableLastDoneAt(t.LastDoneAt).SetNillableLastRemindDueAt(t.LastRemindDueAt).SetOverdueNotifyCount(t.OverdueNotifyCount).SetNillableOverdueNotifyLimit(t.OverdueNotifyLimit).SetNillableLastOverdueNotifiedAt(t.LastOverdueNotifiedAt).SetIsPaused(t.IsPaused).SetCreatedAt(t.CreatedAt).SetUpdatedAt(t.UpdatedAt).SetRevision(t.Revision).SetPosition(t.Position).Save(ctx)
	} else {
		update := r.client.RemindTask.UpdateOneID(uid).SetTitle(t.Title).SetIntervalDays(t.IntervalDays).SetTimeOfDay(t.TimeOfDay).SetRemindBeforeMinutes(t.RemindBeforeMinutes).SetStartAt(t.StartAt).SetNextDueAt(t.NextDueAt).SetOverdueNotifyCount(t.OverdueNotifyCount).SetIsPaused(t.IsPaused).SetUpdatedAt(t.UpdatedAt).SetRevision(t.Revision).SetPosition(t.Position)
		setNullable(t.MessageID, update.SetMessageID, update.ClearMessageID)
		setNullable(t.Description, update.SetDescription, update.ClearDescription)
		setNullable(t.LastDoneAt, update.SetLastDoneAt, update.ClearLastDoneAt)
		setNullable(t.LastRemindDueAt, update.SetLastRemindDueAt, update.ClearLastRemindDueAt)
		setNullable(t.OverdueNotifyLimit, update.SetOverdueNotifyLimit, update.ClearOverdueNotifyLimit)
		setNullable(t.LastOverdueNotifiedAt, update.SetLastOverdueNotifiedAt, update.ClearLastOverdueNotifiedAt)
		_, e = update.Save(ctx)
	}
	if e != nil || !replace {
		return e
	}
	if _, e = r.client.RemindTaskInventoryItem.Delete().Where(remindtaskinventoryitem.TaskChannelIDEQ(t.ChannelID), remindtaskinventoryitem.TaskIDEQ(t.ID)).Exec(ctx); e != nil {
		return e
	}
	if len(t.InventoryItems) > 0 && inventoryChannel == nil {
		return domain.Fail("invalid_input", "inventoryChannel", "Inventory is not linked")
	}
	for position, i := range t.InventoryItems {
		id, e := uuid.Parse(i.EntityID)
		if e != nil {
			return e
		}
		_, e = r.client.RemindTaskInventoryItem.Create().SetID(id).SetTaskChannelID(t.ChannelID).SetTaskID(t.ID).SetInventoryChannelID(*inventoryChannel).SetInventoryID(i.InventoryID).SetConsume(i.Consume.String()).SetPosition(position).Save(ctx)
		if e != nil {
			return e
		}
	}
	return nil
}
func (r *repository) DeleteTask(ctx context.Context, channel, id string) error {
	count, e := r.client.RemindTask.Delete().Where(remindtask.ChannelIDEQ(channel), remindtask.LegacyIDEQ(id)).Exec(ctx)
	if e == nil && count == 0 {
		return domain.Fail("not_found", id, "Task does not exist")
	}
	return e
}
