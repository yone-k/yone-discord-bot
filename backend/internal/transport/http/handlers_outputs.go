package httptransport

import (
	"context"
	"github.com/oapi-codegen/nullable"
	"regexp"
	"strconv"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
)

var outputActorIDPattern = regexp.MustCompile(`^[0-9]+$`)

func optionalOutputString(value string) nullable.Nullable[string] {
	if value == "" {
		return toNullable[string](nil)
	}
	return toNullable(&value)
}

func outputActorContext(ctx context.Context, actor string, kind api.OutputOperationKind, interaction *string) (context.Context, error) {
	if !outputActorIDPattern.MatchString(actor) || interaction != nil && !outputActorIDPattern.MatchString(*interaction) {
		return nil, domain.Fail(domain.CodeInvalidInput, "actor", "Invalid output actor headers")
	}
	op := application.OutputOperation{ActorID: actor, Kind: application.OperationKind(kind)}
	if interaction != nil {
		op.InteractionID = *interaction
	}
	updated, err := application.WithOutputOperation(ctx, op)
	if err != nil {
		return nil, domain.Fail(domain.CodeInvalidInput, "operationKind", "Invalid output operation")
	}
	return updated, nil
}

func (h *Handler) RecordOutputEvent(ctx context.Context, r api.RecordOutputEventRequestObject) (api.RecordOutputEventResponseObject, error) {
	ctx, err := outputActorContext(ctx, r.Params.XActorId, r.Params.XOperationKind, r.Params.XInteractionId)
	if err != nil {
		return nil, err
	}
	b := r.Body
	when, err := parseTimestamp(b.OccurredAt)
	if err != nil {
		return nil, err
	}
	event := application.OutputLogEvent{ActorID: b.ActorId, ChannelID: b.ChannelId, InteractionID: b.InteractionId, OperationKind: application.OperationKind(b.OperationKind), OccurredAt: when, Success: b.Success}
	if b.Message != nil {
		event.Message = *b.Message
	}
	if b.CancelReason != nil {
		event.CancelReason = *b.CancelReason
	}
	ids, err := h.Service.RecordOutputEvent(ctx, event)
	if err != nil {
		return nil, err
	}
	return api.RecordOutputEvent200JSONResponse{TaskIds: ids}, nil
}

func (h *Handler) RequestDeleteAll(ctx context.Context, r api.RequestDeleteAllRequestObject) (api.RequestDeleteAllResponseObject, error) {
	ctx, err := outputActorContext(ctx, r.Params.XActorId, r.Params.XOperationKind, r.Params.XInteractionId)
	if err != nil {
		return nil, err
	}
	job, err := h.Service.RequestDeleteAll(ctx, r.ChannelId)
	if err != nil {
		return nil, err
	}
	return api.RequestDeleteAll200JSONResponse(mapOutputJob(*job)), nil
}

func (h *Handler) GetOutputJob(ctx context.Context, r api.GetOutputJobRequestObject) (api.GetOutputJobResponseObject, error) {
	job, err := h.Service.GetOutputJob(ctx, r.JobId)
	if err != nil {
		return nil, err
	}
	return api.GetOutputJob200JSONResponse(mapOutputJob(*job)), nil
}

func (h *Handler) InitializeOutputs(ctx context.Context, r api.InitializeOutputsRequestObject) (api.InitializeOutputsResponseObject, error) {
	ctx, err := outputActorContext(ctx, r.Params.XActorId, r.Params.XOperationKind, r.Params.XInteractionId)
	if err != nil {
		return nil, err
	}
	ids, err := h.Service.InitializeOutputs(ctx, r.ChannelId, string(r.Body.Kind), r.Body.EnableLog)
	if err != nil {
		return nil, err
	}
	return api.InitializeOutputs200JSONResponse{TaskIds: ids}, nil
}

func (h *Handler) RedrawOutputs(ctx context.Context, r api.RedrawOutputsRequestObject) (api.RedrawOutputsResponseObject, error) {
	ctx, err := outputActorContext(ctx, r.Params.XActorId, r.Params.XOperationKind, r.Params.XInteractionId)
	if err != nil {
		return nil, err
	}
	ids, err := h.Service.RedrawOutputs(ctx, r.ChannelId, string(r.Body.Kind))
	if err != nil {
		return nil, err
	}
	return api.RedrawOutputs200JSONResponse{TaskIds: ids}, nil
}

func (h *Handler) SetOutputCardView(ctx context.Context, r api.SetOutputCardViewRequestObject) (api.SetOutputCardViewResponseObject, error) {
	ctx, err := outputActorContext(ctx, r.Params.XActorId, r.Params.XOperationKind, r.Params.XInteractionId)
	if err != nil {
		return nil, err
	}
	input := application.CardView{ChannelID: r.ChannelId, TargetID: r.TargetId, TargetKind: application.CardTarget(r.TargetKind), Mode: application.CardMode(r.Body.Mode)}
	if r.Body.Page != nil {
		input.Page = *r.Body.Page
	}
	view, err := h.Service.SetCardView(ctx, input)
	if err != nil {
		return nil, err
	}
	return api.SetOutputCardView200JSONResponse{ChannelId: view.ChannelID, TargetId: view.TargetID, TargetKind: api.OutputTargetKind(view.TargetKind), Mode: api.OutputCardMode(view.Mode), Page: int32(view.Page), Version: strconv.FormatInt(view.Version, 10)}, nil
}

func (h *Handler) GetOutputStatus(ctx context.Context, _ api.GetOutputStatusRequestObject) (api.GetOutputStatusResponseObject, error) {
	running := h.OutputWorkerRunning != nil && h.OutputWorkerRunning()
	status, err := h.Service.GetOutputStatus(ctx, h.OutputEnabled, running)
	if err != nil {
		return nil, err
	}
	out := api.OutputStatus{Contract: api.OutputStatusContract(status.Contract), Enabled: status.Enabled, WorkerRunning: status.WorkerRunning, OldestPendingAt: mapNullableTimestamp(status.OldestPendingAt), Counts: []api.OutputStateCount{}, Holds: []api.OutputHold{}, Suspensions: []api.OutputChannelStop{}}
	for _, count := range status.Counts {
		out.Counts = append(out.Counts, api.OutputStateCount{State: api.OutputTaskState(count.State), Count: int32(count.Count)})
	}
	for _, stop := range status.Suspensions {
		out.Suspensions = append(out.Suspensions, api.OutputChannelStop{ChannelId: stop.ChannelID, SuspendedBy: stop.SuspendedBy, SuspendedAt: mapTimestamp(stop.SuspendedAt)})
	}
	for _, hold := range status.Holds {
		out.Holds = append(out.Holds, api.OutputHold{TaskId: hold.TaskID, ChannelId: hold.ChannelID, Kind: api.OutputTaskKind(hold.Kind), State: api.OutputTaskState(hold.State), Reason: hold.Reason, DependencyTaskId: optionalOutputString(hold.DependencyTaskID)})
	}
	return api.GetOutputStatus200JSONResponse(out), nil
}

func mapOutputJob(job application.OutputTask) api.OutputJob {
	out := api.OutputJob{JobId: job.ID, ChannelId: job.ChannelID, State: api.OutputTaskState(job.State), LastError: optionalOutputString(job.LastError)}
	if p := job.Payload.Deletion; p != nil {
		out.ConfirmedDeletedCount, out.FirstAttemptFinished = int32(len(p.ConfirmedIDs)), p.FirstAttemptFinished
	}
	return out
}
