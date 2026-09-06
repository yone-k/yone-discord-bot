package httptransport

import (
	"context"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

type Handler struct {
	Service *application.Service
	Check   func(context.Context) error
}

var _ api.StrictServerInterface = (*Handler)(nil)

func (h *Handler) Health(ctx context.Context, _ api.HealthRequestObject) (api.HealthResponseObject, error) {
	if h.Check == nil || h.Check(ctx) != nil {
		return api.Health503JSONResponse{Ready: false}, nil
	}
	return api.Health200JSONResponse{Ready: true}, nil
}
func (h *Handler) ListListChannels(ctx context.Context, _ api.ListListChannelsRequestObject) (api.ListListChannelsResponseObject, error) {
	rows, e := h.Service.ListChannels(ctx)
	if e != nil {
		return nil, e
	}
	return api.ListListChannels200JSONResponse(mapSlice(rows, mapListChannel)), nil
}
func (h *Handler) GetListChannel(ctx context.Context, r api.GetListChannelRequestObject) (api.GetListChannelResponseObject, error) {
	v, e := h.Service.GetListChannel(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetListChannel200JSONResponse(mapListChannel(*v)), nil
}
func (h *Handler) CreateListChannel(ctx context.Context, r api.CreateListChannelRequestObject) (api.CreateListChannelResponseObject, error) {
	b := r.Body
	if e := requireChannel(r.ChannelId, b.ChannelId); e != nil {
		return nil, e
	}
	v, e := h.Service.SaveListChannel(ctx, domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: b.ChannelId, MessageID: fromNullable(b.MessageId), ListTitle: b.ListTitle, OperationLogThreadID: fromNullable(b.OperationLogThreadId)}, DefaultCategory: b.DefaultCategory})
	if e != nil {
		return nil, e
	}
	return api.CreateListChannel200JSONResponse(mapListChannel(*v)), nil
}
func (h *Handler) PatchListChannel(ctx context.Context, r api.PatchListChannelRequestObject) (api.PatchListChannelResponseObject, error) {
	b := r.Body
	p := application.ChannelPatch{MessageID: optionalNullable(b.MessageId), ListTitle: optionalValue(b.ListTitle), OperationLogThreadID: optionalNullable(b.OperationLogThreadId), DefaultCategory: optionalValue(b.DefaultCategory)}
	v, e := h.Service.PatchListChannel(ctx, r.ChannelId, p)
	if e != nil {
		return nil, e
	}
	return api.PatchListChannel200JSONResponse(mapListChannel(*v)), nil
}
func (h *Handler) DeleteListChannel(ctx context.Context, r api.DeleteListChannelRequestObject) (api.DeleteListChannelResponseObject, error) {
	if e := h.Service.DeleteListChannel(ctx, r.ChannelId); e != nil {
		return nil, e
	}
	return api.DeleteListChannel204Response{}, nil
}
func (h *Handler) GetListItems(ctx context.Context, r api.GetListItemsRequestObject) (api.GetListItemsResponseObject, error) {
	v, e := h.Service.GetList(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetListItems200JSONResponse(mapSlice(v.Items, mapListItem)), nil
}
func (h *Handler) GetListSnapshot(ctx context.Context, r api.GetListSnapshotRequestObject) (api.GetListSnapshotResponseObject, error) {
	v, e := h.Service.GetList(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetListSnapshot200JSONResponse(mapListSnapshot(*v)), nil
}
func (h *Handler) SaveList(ctx context.Context, r api.SaveListRequestObject) (api.SaveListResponseObject, error) {
	rev, e := parseRevision(r.Body.ExpectedVersion)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.SaveList(ctx, r.ChannelId, rev, mapSlice(r.Body.Items, inputListItem))
	if e != nil {
		return nil, e
	}
	return api.SaveList200JSONResponse(mapListSnapshot(*v)), nil
}
func (h *Handler) AppendListItem(ctx context.Context, r api.AppendListItemRequestObject) (api.AppendListItemResponseObject, error) {
	v, e := h.Service.AppendListItem(ctx, r.ChannelId, inputListItem(*r.Body))
	if e != nil {
		return nil, e
	}
	return api.AppendListItem200JSONResponse(mapListItem(*v)), nil
}
func (h *Handler) UpdateListItem(ctx context.Context, r api.UpdateListItemRequestObject) (api.UpdateListItemResponseObject, error) {
	v, e := h.Service.UpdateListItem(ctx, r.ChannelId, r.Id, inputListItem(*r.Body))
	if e != nil {
		return nil, e
	}
	return api.UpdateListItem200JSONResponse(mapListItem(*v)), nil
}
func (h *Handler) DeleteListItem(ctx context.Context, r api.DeleteListItemRequestObject) (api.DeleteListItemResponseObject, error) {
	v, e := h.Service.DeleteListItem(ctx, r.ChannelId, r.Id)
	if e != nil {
		return nil, e
	}
	return api.DeleteListItem200JSONResponse(mapListSnapshot(*v)), nil
}
func (h *Handler) ReorderList(ctx context.Context, r api.ReorderListRequestObject) (api.ReorderListResponseObject, error) {
	v, e := h.Service.ReorderList(ctx, r.ChannelId, r.Body.Ids)
	if e != nil {
		return nil, e
	}
	return api.ReorderList200JSONResponse(mapListSnapshot(*v)), nil
}

func (h *Handler) ListInventoryChannels(ctx context.Context, _ api.ListInventoryChannelsRequestObject) (api.ListInventoryChannelsResponseObject, error) {
	v, e := h.Service.InventoryChannels(ctx)
	if e != nil {
		return nil, e
	}
	return api.ListInventoryChannels200JSONResponse(mapSlice(v, mapInventoryChannel)), nil
}
func (h *Handler) GetInventoryChannel(ctx context.Context, r api.GetInventoryChannelRequestObject) (api.GetInventoryChannelResponseObject, error) {
	v, e := h.Service.GetInventoryChannel(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetInventoryChannel200JSONResponse(mapInventoryChannel(*v)), nil
}
func (h *Handler) CreateInventoryChannel(ctx context.Context, r api.CreateInventoryChannelRequestObject) (api.CreateInventoryChannelResponseObject, error) {
	b := r.Body
	if e := requireChannel(r.ChannelId, b.ChannelId); e != nil {
		return nil, e
	}
	v, e := h.Service.SaveInventoryChannel(ctx, domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: b.ChannelId, MessageID: fromNullable(b.MessageId), ListTitle: b.ListTitle, OperationLogThreadID: fromNullable(b.OperationLogThreadId)}, DefaultCategory: b.DefaultCategory})
	if e != nil {
		return nil, e
	}
	return api.CreateInventoryChannel200JSONResponse(mapInventoryChannel(*v)), nil
}
func (h *Handler) PatchInventoryChannel(ctx context.Context, r api.PatchInventoryChannelRequestObject) (api.PatchInventoryChannelResponseObject, error) {
	b := r.Body
	p := application.ChannelPatch{MessageID: optionalNullable(b.MessageId), ListTitle: optionalValue(b.ListTitle), OperationLogThreadID: optionalNullable(b.OperationLogThreadId), DefaultCategory: optionalValue(b.DefaultCategory)}
	v, e := h.Service.PatchInventoryChannel(ctx, r.ChannelId, p)
	if e != nil {
		return nil, e
	}
	return api.PatchInventoryChannel200JSONResponse(mapInventoryChannel(*v)), nil
}
func (h *Handler) DeleteInventoryChannel(ctx context.Context, r api.DeleteInventoryChannelRequestObject) (api.DeleteInventoryChannelResponseObject, error) {
	if e := h.Service.DeleteInventoryChannel(ctx, r.ChannelId); e != nil {
		return nil, e
	}
	return api.DeleteInventoryChannel204Response{}, nil
}
func (h *Handler) GetInventoryItems(ctx context.Context, r api.GetInventoryItemsRequestObject) (api.GetInventoryItemsResponseObject, error) {
	v, e := h.Service.GetCatalog(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetInventoryItems200JSONResponse(mapSlice(v.Items, mapInventoryItem)), nil
}
func (h *Handler) GetInventoryItem(ctx context.Context, r api.GetInventoryItemRequestObject) (api.GetInventoryItemResponseObject, error) {
	v, e := h.Service.GetInventoryItem(ctx, r.ChannelId, r.Id)
	if e != nil {
		return nil, e
	}
	return api.GetInventoryItem200JSONResponse(mapInventoryItem(*v)), nil
}
func (h *Handler) GetInventoryByName(ctx context.Context, r api.GetInventoryByNameRequestObject) (api.GetInventoryByNameResponseObject, error) {
	v, e := h.Service.GetInventoryByName(ctx, r.ChannelId, r.Params.Name)
	if e != nil {
		return nil, e
	}
	return api.GetInventoryByName200JSONResponse(mapInventoryItem(*v)), nil
}
func (h *Handler) AppendInventoryItem(ctx context.Context, r api.AppendInventoryItemRequestObject) (api.AppendInventoryItemResponseObject, error) {
	input, e := inputInventoryItem("", *r.Body)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.AppendInventoryItem(ctx, r.ChannelId, input)
	if e != nil {
		return nil, e
	}
	return api.AppendInventoryItem200JSONResponse(mapInventoryItem(*v)), nil
}
func (h *Handler) UpdateInventoryItem(ctx context.Context, r api.UpdateInventoryItemRequestObject) (api.UpdateInventoryItemResponseObject, error) {
	input, e := inputInventoryItem(r.Id, *r.Body)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.UpdateInventoryItem(ctx, r.ChannelId, r.Id, input)
	if e != nil {
		return nil, e
	}
	return api.UpdateInventoryItem200JSONResponse(mapInventoryItem(*v)), nil
}
func (h *Handler) BulkUpdateInventory(ctx context.Context, r api.BulkUpdateInventoryRequestObject) (api.BulkUpdateInventoryResponseObject, error) {
	input, e := inputInventoryItems(r.Body.Items)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.UpdateInventoryItems(ctx, r.ChannelId, input)
	if e != nil {
		return nil, e
	}
	return api.BulkUpdateInventory200JSONResponse(mapSlice(v, mapInventoryItem)), nil
}
func (h *Handler) ApplyInventory(ctx context.Context, r api.ApplyInventoryRequestObject) (api.ApplyInventoryResponseObject, error) {
	expected, e := inputInventoryItems(r.Body.Expected)
	if e != nil {
		return nil, e
	}
	input, e := inputApplyInventoryItems(r.Body.Items)
	if e != nil {
		return nil, e
	}
	v, e := h.Service.ApplyInventory(ctx, r.ChannelId, expected, input)
	if e != nil {
		return nil, e
	}
	return api.ApplyInventory200JSONResponse(mapSlice(v, mapInventoryItem)), nil
}
func (h *Handler) DeleteInventoryItem(ctx context.Context, r api.DeleteInventoryItemRequestObject) (api.DeleteInventoryItemResponseObject, error) {
	v, e := h.Service.DeleteInventoryItem(ctx, r.ChannelId, r.Id)
	if e != nil {
		return nil, e
	}
	return api.DeleteInventoryItem200JSONResponse(mapSlice(v, mapInventoryItem)), nil
}
func (h *Handler) ReorderInventory(ctx context.Context, r api.ReorderInventoryRequestObject) (api.ReorderInventoryResponseObject, error) {
	v, e := h.Service.ReorderInventory(ctx, r.ChannelId, r.Body.Ids)
	if e != nil {
		return nil, e
	}
	return api.ReorderInventory200JSONResponse(mapSlice(v, mapInventoryItem)), nil
}
func (h *Handler) ResolveInventory(ctx context.Context, r api.ResolveInventoryRequestObject) (api.ResolveInventoryResponseObject, error) {
	v, e := h.Service.ResolveInventory(ctx, r.ChannelId, r.Body.Name)
	if e != nil {
		return nil, e
	}
	return api.ResolveInventory200JSONResponse(mapInventoryItem(*v)), nil
}
func (h *Handler) GetLinkedReminders(ctx context.Context, r api.GetLinkedRemindersRequestObject) (api.GetLinkedRemindersResponseObject, error) {
	v, e := h.Service.LinkedReminders(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetLinkedReminders200JSONResponse(mapSlice(v, mapRemindChannel)), nil
}
func (h *Handler) GetInventoryReferences(ctx context.Context, r api.GetInventoryReferencesRequestObject) (api.GetInventoryReferencesResponseObject, error) {
	v, e := h.Service.InventoryReferences(ctx, r.ChannelId, r.Id)
	if e != nil {
		return nil, e
	}
	return api.GetInventoryReferences200JSONResponse(mapSlice(v, mapTask)), nil
}
