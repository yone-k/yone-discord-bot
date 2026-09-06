package httptransport

import (
	"context"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
	"strconv"
)

func mapAppTaskDisplay(v application.TaskDisplay) api.TaskDisplay {
	return api.TaskDisplay{Channel: mapRemindChannel(v.Channel), Task: mapTask(v.Task), Shortages: mapSlice(v.Shortages, mapShortage)}
}
func mapAppListDisplay(v application.ListDisplay) api.ListDisplay {
	return api.ListDisplay{Channel: mapListChannel(v.Channel), Items: mapSlice(v.Items, mapListItem)}
}
func mapAppInventoryDisplay(v application.InventoryDisplay) api.InventoryDisplay {
	return api.InventoryDisplay{Channel: mapInventoryChannel(v.Channel), Items: mapSlice(v.Items, mapInventoryItem)}
}
func mapPointer[A, B any](v *A, convert func(A) B) *B {
	if v == nil {
		return nil
	}
	out := convert(*v)
	return &out
}
func mapNotification(v application.Notification) api.Notification {
	var revision *string
	if v.ExpectedRevision != nil {
		s := strconv.FormatInt(*v.ExpectedRevision, 10)
		revision = &s
	}
	return api.Notification{
		Kind: api.NotificationKind(v.Kind), ChannelId: v.ChannelID, Id: v.ID, EvaluatedAt: mapTimestamp(v.EvaluatedAt), TargetDueAt: v.TargetDueAt,
		ExpectedRevision: toNullable(revision), List: toNullable(mapPointer(v.List, mapAppListDisplay)), Item: toNullable(mapPointer(v.Item, mapListItem)), Reminder: toNullable(mapPointer(v.Reminder, mapAppTaskDisplay)),
	}
}
func (h *Handler) GetRelatedTasks(ctx context.Context, r api.GetRelatedTasksRequestObject) (api.GetRelatedTasksResponseObject, error) {
	v, e := h.Service.GetRelatedTasks(ctx, r.ChannelId)
	if e != nil {
		return nil, e
	}
	return api.GetRelatedTasks200JSONResponse(mapSlice(v, mapAppTaskDisplay)), nil
}
func (h *Handler) GetInitialization(ctx context.Context, _ api.GetInitializationRequestObject) (api.GetInitializationResponseObject, error) {
	v, e := h.Service.GetInitialization(ctx)
	if e != nil {
		return nil, e
	}
	return api.GetInitialization200JSONResponse{Lists: mapSlice(v.Lists, mapAppListDisplay), Inventories: mapSlice(v.Inventories, mapAppInventoryDisplay), Reminders: mapSlice(v.Reminders, mapAppTaskDisplay), RemindChannels: mapSlice(v.RemindChannels, mapRemindChannel)}, nil
}
func (h *Handler) PollNotifications(ctx context.Context, _ api.PollNotificationsRequestObject) (api.PollNotificationsResponseObject, error) {
	v, e := h.Service.PollNotifications(ctx)
	if e != nil {
		return nil, e
	}
	return api.PollNotifications200JSONResponse{EvaluatedAt: mapTimestamp(v.EvaluatedAt), Notifications: mapSlice(v.Notifications, mapNotification), Progress: mapSlice(v.Progress, func(p application.ProgressUpdate) api.ProgressUpdate {
		return api.ProgressUpdate{Kind: api.ProgressUpdateKind(p.Kind), Reminder: mapAppTaskDisplay(p.Reminder), EvaluatedAt: mapTimestamp(p.EvaluatedAt)}
	})}, nil
}
func (h *Handler) AckNotification(ctx context.Context, r api.AckNotificationRequestObject) (api.AckNotificationResponseObject, error) {
	b := r.Body
	stamp, e := parseTimestamp(b.EvaluatedAt)
	if e != nil {
		return nil, e
	}
	var revision *int64
	if str := fromNullable(b.ExpectedRevision); str != nil {
		v, e := parseRevision(*str)
		if e != nil {
			return nil, e
		}
		revision = &v
	}
	if b.Kind == api.NotificationTokenKindList {
		if e := domain.ValidateDate(b.TargetDueAt); e != nil {
			return nil, e
		}
	} else {
		if _, e := parseTimestamp(b.TargetDueAt); e != nil {
			return nil, e
		}
	}
	v, e := h.Service.AckNotification(ctx, application.NotificationToken{Kind: string(b.Kind), ChannelID: b.ChannelId, ID: b.Id, EvaluatedAt: stamp, TargetDueAt: b.TargetDueAt, ExpectedRevision: revision})
	if e != nil {
		return nil, e
	}
	return api.AckNotification200JSONResponse{Item: toNullable(mapPointer(v.Item, mapListItem)), Task: toNullable(mapPointer(v.Task, mapTask))}, nil
}
