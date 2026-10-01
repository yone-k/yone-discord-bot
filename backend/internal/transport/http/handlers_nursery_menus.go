package httptransport

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

func mapNurseryMenu(menu domain.NurseryMenu) api.NurseryMenu {
	entry := func(v string) *string {
		if v == "" {
			return nil
		}
		return &v
	}
	return api.NurseryMenu{Date: menu.Date, Lunch: toNullable(entry(menu.Lunch)), Snack: toNullable(entry(menu.Snack)), CreatedAt: mapTimestamp(menu.CreatedAt), UpdatedAt: mapTimestamp(menu.UpdatedAt)}
}

func entryText(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func (h *Handler) ListNurseryMenus(ctx context.Context, r api.ListNurseryMenusRequestObject) (api.ListNurseryMenusResponseObject, error) {
	v, e := h.Service.ListNurseryMenus(ctx, r.Params.From, r.Params.To)
	if e != nil {
		return nil, e
	}
	return api.ListNurseryMenus200JSONResponse(mapSlice(v, mapNurseryMenu)), nil
}
func (h *Handler) PutNurseryMenusBatch(ctx context.Context, r api.PutNurseryMenusBatchRequestObject) (api.PutNurseryMenusBatchResponseObject, error) {
	entries := make([]application.NurseryMenuEntry, 0, len(r.Body.Items))
	for _, item := range r.Body.Items {
		entries = append(entries, application.NurseryMenuEntry{Date: item.Date, Lunch: entryText(item.Lunch), Snack: entryText(item.Snack)})
	}
	v, e := h.Service.PutNurseryMenus(ctx, entries)
	if e != nil {
		return nil, e
	}
	return api.PutNurseryMenusBatch200JSONResponse(mapSlice(v, mapNurseryMenu)), nil
}
func (h *Handler) GetNurseryMenu(ctx context.Context, r api.GetNurseryMenuRequestObject) (api.GetNurseryMenuResponseObject, error) {
	v, e := h.Service.GetNurseryMenu(ctx, r.Date)
	if e != nil {
		return nil, e
	}
	return api.GetNurseryMenu200JSONResponse(mapNurseryMenu(*v)), nil
}
func (h *Handler) PutNurseryMenu(ctx context.Context, r api.PutNurseryMenuRequestObject) (api.PutNurseryMenuResponseObject, error) {
	v, e := h.Service.PutNurseryMenu(ctx, r.Date, entryText(r.Body.Lunch), entryText(r.Body.Snack))
	if e != nil {
		return nil, e
	}
	return api.PutNurseryMenu200JSONResponse(mapNurseryMenu(*v)), nil
}
func (h *Handler) DeleteNurseryMenu(ctx context.Context, r api.DeleteNurseryMenuRequestObject) (api.DeleteNurseryMenuResponseObject, error) {
	if e := h.Service.DeleteNurseryMenu(ctx, r.Date); e != nil {
		return nil, e
	}
	return api.DeleteNurseryMenu204Response{}, nil
}
func (h *Handler) GetNurseryMenuChannel(ctx context.Context, _ api.GetNurseryMenuChannelRequestObject) (api.GetNurseryMenuChannelResponseObject, error) {
	v, e := h.Service.GetNurseryMenuChannel(ctx)
	if e != nil {
		return nil, e
	}
	return api.GetNurseryMenuChannel200JSONResponse{ChannelId: v}, nil
}
func (h *Handler) SetNurseryMenuChannel(ctx context.Context, r api.SetNurseryMenuChannelRequestObject) (api.SetNurseryMenuChannelResponseObject, error) {
	v, e := h.Service.SetNurseryMenuChannel(ctx, r.Body.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.SetNurseryMenuChannel200JSONResponse{ChannelId: v}, nil
}
