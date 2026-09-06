package httptransport

import (
	"context"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

func (h *Handler) ListRemindChannels(ctx context.Context, _ api.ListRemindChannelsRequestObject) (api.ListRemindChannelsResponseObject, error) {
	v, e := h.Service.RemindChannels(ctx)
	if e != nil {
		return nil, e
	}
	return api.ListRemindChannels200JSONResponse(mapSlice(v, mapRemindChannel)), nil
}
func (h *Handler) GetRemindChannel(ctx context.Context, r api.GetRemindChannelRequestObject) (api.GetRemindChannelResponseObject, error) {
	v, e := h.Service.GetRemindChannel(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetRemindChannel200JSONResponse(mapRemindChannel(*v)), nil
}
func (h *Handler) CreateRemindChannel(ctx context.Context, r api.CreateRemindChannelRequestObject) (api.CreateRemindChannelResponseObject, error) {
	b := r.Body
	if e := requireChannel(r.ChannelId, b.ChannelId); e != nil {
		return nil, e
	}
	v, e := h.Service.SaveRemindChannel(ctx, domain.RemindChannelSettings{ChannelSettings: domain.ChannelSettings{ChannelID: b.ChannelId, MessageID: fromNullable(b.MessageId), ListTitle: b.ListTitle, OperationLogThreadID: fromNullable(b.OperationLogThreadId)}, RemindNoticeThreadID: fromNullable(b.RemindNoticeThreadId), RemindNoticeMessageID: fromNullable(b.RemindNoticeMessageId), LinkedInventoryChannelID: fromNullable(b.LinkedInventoryChannelId)})
	if e != nil {
		return nil, e
	}
	return api.CreateRemindChannel200JSONResponse(mapRemindChannel(*v)), nil
}
func (h *Handler) PatchRemindChannel(ctx context.Context, r api.PatchRemindChannelRequestObject) (api.PatchRemindChannelResponseObject, error) {
	b := r.Body
	p := application.ChannelPatch{MessageID: optionalNullable(b.MessageId), ListTitle: optionalValue(b.ListTitle), OperationLogThreadID: optionalNullable(b.OperationLogThreadId), RemindNoticeThreadID: optionalNullable(b.RemindNoticeThreadId), RemindNoticeMessageID: optionalNullable(b.RemindNoticeMessageId)}
	v, e := h.Service.PatchRemindChannel(ctx, r.ChannelId, p)
	if e != nil {
		return nil, e
	}
	return api.PatchRemindChannel200JSONResponse(mapRemindChannel(*v)), nil
}
func (h *Handler) DeleteRemindChannel(ctx context.Context, r api.DeleteRemindChannelRequestObject) (api.DeleteRemindChannelResponseObject, error) {
	if e := h.Service.DeleteRemindChannel(ctx, r.ChannelId); e != nil {
		return nil, e
	}
	return api.DeleteRemindChannel204Response{}, nil
}
func (h *Handler) LinkInventory(ctx context.Context, r api.LinkInventoryRequestObject) (api.LinkInventoryResponseObject, error) {
	v, e := h.Service.LinkInventory(ctx, r.ChannelId, fromNullable(r.Body.InventoryChannelId))
	if e != nil {
		return nil, e
	}
	return api.LinkInventory200JSONResponse(mapRemindChannel(*v)), nil
}
func (h *Handler) GetTasks(ctx context.Context, r api.GetTasksRequestObject) (api.GetTasksResponseObject, error) {
	v, e := h.Service.Tasks(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetTasks200JSONResponse(mapSlice(v, mapTask)), nil
}
func (h *Handler) GetTask(ctx context.Context, r api.GetTaskRequestObject) (api.GetTaskResponseObject, error) {
	v, e := h.Service.GetTask(ctx, r.ChannelId, r.Id)
	if e != nil {
		return nil, e
	}
	return api.GetTask200JSONResponse(mapTask(*v)), nil
}
func (h *Handler) GetTaskByMessage(ctx context.Context, r api.GetTaskByMessageRequestObject) (api.GetTaskByMessageResponseObject, error) {
	v, e := h.Service.GetTaskByMessage(ctx, r.ChannelId, r.Params.MessageId)
	if e != nil {
		return nil, e
	}
	return api.GetTaskByMessage200JSONResponse(mapTask(*v)), nil
}
func (h *Handler) CreateTask(ctx context.Context, r api.CreateTaskRequestObject) (api.CreateTaskResponseObject, error) {
	b := r.Body
	refs, e := inputConsumptions(b.InventoryItems)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.CreateTask(ctx, r.ChannelId, application.CreateTaskInput{Title: b.Title, Description: fromNullable(b.Description), IntervalDays: int(b.IntervalDays), TimeOfDay: b.TimeOfDay, RemindBeforeMinutes: int(b.RemindBeforeMinutes), InventoryItems: refs})
	if e != nil {
		return nil, e
	}
	return api.CreateTask200JSONResponse(mapTask(*v)), nil
}
func (h *Handler) PatchTask(ctx context.Context, r api.PatchTaskRequestObject) (api.PatchTaskResponseObject, error) {
	rev, e := parseRevision(r.Body.ExpectedRevision)
	if e != nil {
		return nil, e
	}
	p, e := inputTaskPatch(r.Body.Patch)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.PatchTask(ctx, r.ChannelId, r.Id, rev, p)
	if e != nil {
		return nil, e
	}
	return api.PatchTask200JSONResponse(mapTask(*v)), nil
}
func (h *Handler) PauseTask(ctx context.Context, r api.PauseTaskRequestObject) (api.PauseTaskResponseObject, error) {
	rev, e := parseRevision(r.Body.ExpectedRevision)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.SetTaskPaused(ctx, r.ChannelId, r.Id, rev, true)
	if e != nil {
		return nil, e
	}
	return api.PauseTask200JSONResponse(mapTask(*v)), nil
}
func (h *Handler) ResumeTask(ctx context.Context, r api.ResumeTaskRequestObject) (api.ResumeTaskResponseObject, error) {
	rev, e := parseRevision(r.Body.ExpectedRevision)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.SetTaskPaused(ctx, r.ChannelId, r.Id, rev, false)
	if e != nil {
		return nil, e
	}
	return api.ResumeTask200JSONResponse(mapTask(*v)), nil
}
func (h *Handler) EditTaskInventory(ctx context.Context, r api.EditTaskInventoryRequestObject) (api.EditTaskInventoryResponseObject, error) {
	rev, e := parseRevision(r.Body.ExpectedRevision)
	if e != nil {
		return nil, e
	}
	items, e := inputInventoryEdits(r.Body.Items)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.EditTaskInventory(ctx, r.ChannelId, r.Id, rev, items)
	if e != nil {
		return nil, e
	}
	return api.EditTaskInventory200JSONResponse{Task: mapTask(v.Task), InventoryChannelId: toNullable(v.InventoryChannelID), StockChanged: v.StockChanged}, nil
}
func (h *Handler) DeleteTask(ctx context.Context, r api.DeleteTaskRequestObject) (api.DeleteTaskResponseObject, error) {
	if e := h.Service.DeleteTask(ctx, r.ChannelId, r.Id); e != nil {
		return nil, e
	}
	return api.DeleteTask204Response{}, nil
}
func (h *Handler) ReorderTasks(ctx context.Context, r api.ReorderTasksRequestObject) (api.ReorderTasksResponseObject, error) {
	v, e := h.Service.ReorderTasks(ctx, r.ChannelId, r.Body.Ids)
	if e != nil {
		return nil, e
	}
	return api.ReorderTasks200JSONResponse(mapSlice(v, mapTask)), nil
}
func (h *Handler) CompleteTask(ctx context.Context, r api.CompleteTaskRequestObject) (api.CompleteTaskResponseObject, error) {
	rev, e := parseRevision(r.Body.ExpectedRevision)
	if e != nil {
		return nil, e
	}
	items, e := inputOverrides(r.Body.ConsumeOverrides)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.CompleteTask(ctx, r.ChannelId, r.Id, rev, items)
	if e != nil {
		return nil, e
	}
	return api.CompleteTask200JSONResponse(mapTask(*v)), nil
}
func (h *Handler) CheckTaskShortage(ctx context.Context, r api.CheckTaskShortageRequestObject) (api.CheckTaskShortageResponseObject, error) {
	v, e := h.Service.CheckTaskShortage(ctx, r.ChannelId, r.Id)
	if e != nil {
		return nil, e
	}
	return api.CheckTaskShortage200JSONResponse{Shortages: mapSlice(v, mapShortage)}, nil
}
