package httptransport

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

func mapAppTaskDisplay(v application.TaskDisplay) api.TaskDisplay {
	return api.TaskDisplay{Channel: mapRemindChannel(v.Channel), Task: mapTask(v.Task), Shortages: mapSlice(v.Shortages, mapShortage)}
}

func (h *Handler) GetRelatedTasks(ctx context.Context, r api.GetRelatedTasksRequestObject) (api.GetRelatedTasksResponseObject, error) {
	v, e := h.Service.GetRelatedTasks(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetRelatedTasks200JSONResponse(mapSlice(v, mapAppTaskDisplay)), nil
}
