package application

import (
	"context"
	"reflect"
	"regexp"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

var messageOutputStage = regexp.MustCompile(`^message(?::[1-9][0-9]*)?$`)

// IsMessageOutputStage accepts the initial creation and numbered card replacements.
func IsMessageOutputStage(stage string) bool {
	return messageOutputStage.MatchString(stage)
}

type bindingSnapshot struct {
	detail        *OutputDetails
	stage         OutputStage
	boundID       string
	otherID       string
	dispatch      *OutputDispatch
	replacingCard bool
}

func (s *Service) bindingSnapshot(ctx context.Context, id, stageName string) (*bindingSnapshot, error) {
	actor, ok := OutputOperationFromContext(ctx)
	if !ok || actor.Kind != "outputctl" || !discordID.MatchString(actor.ActorID) {
		return nil, domain.Fail(domain.CodeInvalidInput, "actor", "An outputctl operator is required")
	}
	detail, err := s.GetOutputDetails(ctx, id)
	if err != nil {
		return nil, err
	}
	job := detail.Task
	if job.State == OutputRunning || job.State == OutputPending || job.State == OutputSucceeded || job.State == OutputCancelled && !job.Payload.HoldCreation {
		return nil, domain.Fail(domain.CodeConflict, id, "Output is not awaiting a binding")
	}
	valid := outputCard(job.Kind) && IsMessageOutputStage(stageName)
	valid = valid || (job.Kind == OutputOperationLog || job.Kind == OutputReminderNotice || job.Kind == OutputListDeadlineNotice) && stageName == "message"
	valid = valid || job.Kind == OutputThreadEnsure && (stageName == "thread" || stageName == "parent" && job.Payload.ThreadPurpose == "reminder_notice")
	if !valid {
		return nil, domain.Fail(domain.CodeInvalidInput, "stage", "Invalid output binding stage")
	}
	result := &bindingSnapshot{detail: detail}
	found := false
	for _, stage := range job.Payload.Stages {
		if stage.Name == stageName {
			result.stage, found = stage, true
			break
		}
	}
	if !found {
		// An imported notification destination can be missing without any new POST.
		if job.Kind != OutputThreadEnsure && (!job.Payload.Restored || stageName != "message") {
			return nil, domain.Fail(domain.CodeConflict, id, "No creation stage to bind")
		}
		result.stage = OutputStage{Name: stageName, DestinationID: job.ChannelID}
		if !outputCard(job.Kind) && job.Kind != OutputThreadEnsure {
			result.stage.DestinationID = job.Payload.DestinationID
		}
	}
	if result.stage.Done && !job.Payload.Restored {
		return nil, domain.Fail(domain.CodeConflict, id, "Stage already resolved")
	}
	for i := range detail.Dispatches {
		if detail.Dispatches[i].ID == result.stage.CurrentDispatchID {
			result.dispatch = &detail.Dispatches[i]
			if result.dispatch.Outcome != DispatchUnknown && !(job.Payload.Restored && result.stage.Done && result.dispatch.Outcome == DispatchSucceeded) {
				return nil, domain.Fail(domain.CodeConflict, id, "Dispatch is not awaiting a result")
			}
		}
	}
	if result.stage.CurrentDispatchID != "" && result.dispatch == nil {
		return nil, domain.Fail(domain.CodeConflict, id, "Dispatch evidence is missing")
	}
	err = s.store.Read(ctx, func(r Repository) error {
		if !found && result.stage.DestinationID == "" {
			switch job.Kind {
			case OutputReminderNotice:
				channel, err := r.GetRemindChannel(ctx, job.ChannelID, false)
				if err != nil {
					return err
				}
				if channel != nil && channel.RemindNoticeThreadID != nil {
					result.stage.DestinationID = *channel.RemindNoticeThreadID
				}
			case OutputListDeadlineNotice:
				list, err := r.GetList(ctx, job.ChannelID, false)
				if err != nil {
					return err
				}
				if list != nil && list.Channel.OperationLogThreadID != nil {
					result.stage.DestinationID = *list.Channel.OperationLogThreadID
				}
			}
		}
		result.boundID, err = outputBinding(ctx, r, job, stageName, false)
		if err == nil && job.Kind == OutputThreadEnsure && job.Payload.ThreadPurpose == "reminder_notice" {
			result.otherID, err = outputBinding(ctx, r, job, otherThreadStage(stageName), false)
		}
		return err
	})
	if err == nil && !discordID.MatchString(result.stage.DestinationID) {
		err = domain.Fail(domain.CodeConflict, id, "Resolve the output destination before binding")
	}
	return result, err
}

// BindOutput verifies Discord outside the transaction, then commits the ID,
// delivery evidence and audit together. No business operation is replayed.
func (s *Service) BindOutput(ctx context.Context, gateway DiscordGateway, botID, id, stageName, messageID string) error {
	state, err := s.bindingSnapshot(ctx, id, stageName)
	if err != nil {
		return err
	}
	if state.detail.Task.Payload.Restored && outputCard(state.detail.Task.Kind) {
		if err := verifyRestoredCardReplacement(ctx, gateway, state, messageID); err != nil {
			return err
		}
	}
	if err := verifyOutputBinding(ctx, gateway, botID, state, messageID); err != nil {
		return err
	}
	return s.commitOutputBinding(ctx, state, messageID, "bind")
}

// Only an explicit binding can replace a restored card's stale ID. A missing
// message response is required for every differing retained ID; access failures
// and a failed search do not prove absence.
func verifyRestoredCardReplacement(ctx context.Context, gateway DiscordGateway, state *bindingSnapshot, messageID string) error {
	if !discordID.MatchString(messageID) {
		return domain.Fail(domain.CodeInvalidInput, "discordId", "Invalid Discord identity")
	}
	oldIDs := []string{state.boundID}
	if state.stage.Done && state.stage.MessageID != state.boundID {
		oldIDs = append(oldIDs, state.stage.MessageID)
	}
	for _, oldID := range oldIDs {
		if oldID == "" || oldID == messageID {
			continue
		}
		_, err := gateway.GetMessage(ctx, state.stage.DestinationID, oldID)
		if err == nil {
			return domain.Fail(domain.CodeConflict, oldID, "Previously bound card still exists")
		}
		if !unknownDiscordMessage(err) {
			return err
		}
		state.replacingCard = true
	}
	return nil
}

// ReconcileOutput uses only a retained ID or one exact nonce match. A bounded
// search with no match leaves the uncertainty intact, never authorizing retry.
func (s *Service) ReconcileOutput(ctx context.Context, gateway DiscordGateway, botID, id, stageName string) (bool, error) {
	state, err := s.bindingSnapshot(ctx, id, stageName)
	if err != nil {
		return false, err
	}
	messageID := state.boundID
	if messageID == "" && state.dispatch != nil {
		messageID = state.dispatch.DiscordMessageID
	}
	if messageID == "" {
		messageID = state.stage.MessageID
	}
	if messageID == "" && state.dispatch != nil && state.dispatch.Nonce != "" {
		messages, err := gateway.ListMessages(ctx, state.stage.DestinationID, "", 100)
		if err != nil {
			return false, err
		}
		for _, message := range messages {
			if message.Nonce != state.dispatch.Nonce || message.ChannelID != state.stage.DestinationID || message.AuthorID != botID || !message.AuthorIsBot {
				continue
			}
			if messageID != "" && messageID != message.ID {
				return false, domain.Fail(domain.CodeConflict, id, "Multiple nonce matches")
			}
			messageID = message.ID
		}
	}
	if messageID == "" {
		return false, nil
	}
	if err := verifyOutputBinding(ctx, gateway, botID, state, messageID); err != nil {
		return false, err
	}
	if err := s.commitOutputBinding(ctx, state, messageID, "reconcile"); err != nil {
		return false, err
	}
	return true, nil
}

func verifyOutputBinding(ctx context.Context, gateway DiscordGateway, botID string, state *bindingSnapshot, messageID string) error {
	if !discordID.MatchString(botID) || !discordID.MatchString(messageID) {
		return domain.Fail(domain.CodeInvalidInput, "discordId", "Invalid Discord identity")
	}
	if !state.replacingCard && state.boundID != "" && state.boundID != messageID {
		return domain.Fail(domain.CodeConflict, messageID, "Another ID is already bound")
	}
	if !state.replacingCard && state.stage.Done && state.stage.MessageID != messageID {
		return domain.Fail(domain.CodeConflict, messageID, "Confirmed stage has another ID")
	}
	if state.detail.Task.Kind == OutputThreadEnsure && state.detail.Task.Payload.ThreadPurpose == "reminder_notice" {
		// A thread started from a message shares that message's ID:
		// https://docs.discord.com/developers/topics/threads#public--private-threads
		if state.stage.Name == "thread" && state.otherID == "" {
			return domain.Fail(domain.CodeConflict, messageID, "Bind the reminder parent first")
		}
		if state.otherID != "" && state.otherID != messageID {
			return domain.Fail(domain.CodeConflict, messageID, "Reminder parent and thread do not match")
		}
	}
	if state.detail.Task.Kind == OutputThreadEnsure && state.stage.Name == "thread" {
		thread, err := gateway.GetThread(ctx, messageID)
		if err != nil {
			return err
		}
		if thread.ID != messageID || thread.ParentID != state.detail.Task.ChannelID || thread.OwnerID != botID || (thread.Type != 10 && thread.Type != 11) {
			return domain.Fail(domain.CodeInvalidInput, messageID, "Thread identity does not match output")
		}
		return nil
	}
	message, err := gateway.GetMessage(ctx, state.stage.DestinationID, messageID)
	if err != nil {
		return err
	}
	if message.ID != messageID || message.ChannelID != state.stage.DestinationID || message.AuthorID != botID || !message.AuthorIsBot {
		return domain.Fail(domain.CodeInvalidInput, messageID, "Message identity does not match output")
	}
	if state.dispatch != nil && !(state.replacingCard && state.dispatch.Outcome == DispatchSucceeded) && message.Nonce != "" && message.Nonce != state.dispatch.Nonce {
		return domain.Fail(domain.CodeConflict, messageID, "Message nonce conflicts with dispatch")
	}
	return nil
}

func (s *Service) commitOutputBinding(ctx context.Context, snapshot *bindingSnapshot, messageID, action string) error {
	return s.store.Write(ctx, func(r Repository) error {
		if err := r.LockOutputQueue(ctx); err != nil {
			return err
		}
		job := snapshot.detail.Task
		// Lock business parents before the output row, as normal result commits do.
		currentID, err := outputBinding(ctx, r, job, snapshot.stage.Name, true)
		if err != nil {
			return err
		}
		if currentID != snapshot.boundID {
			return domain.Fail(domain.CodeConflict, job.ID, "Binding changed during Discord verification")
		}
		if job.Kind == OutputThreadEnsure && job.Payload.ThreadPurpose == "reminder_notice" {
			otherID, err := outputBinding(ctx, r, job, otherThreadStage(snapshot.stage.Name), true)
			if err != nil {
				return err
			}
			if otherID != snapshot.otherID {
				return domain.Fail(domain.CodeConflict, job.ID, "Reminder destination changed during Discord verification")
			}
		}
		current, err := r.GetOutput(ctx, job.ID, true)
		if err != nil {
			return err
		}
		if current == nil || !reflect.DeepEqual(*current, job) {
			return domain.Fail(domain.CodeConflict, job.ID, "Output changed during Discord verification")
		}
		if err := s.storeCreatedOutputID(ctx, r, job, snapshot.stage.Name, messageID); err != nil {
			return err
		}
		now := s.now()
		if snapshot.dispatch != nil && snapshot.dispatch.Outcome == DispatchUnknown {
			dispatch := *snapshot.dispatch
			dispatch.Outcome, dispatch.DiscordMessageID, dispatch.FinishedAt = DispatchSucceeded, messageID, &now
			if err := r.PutDispatch(ctx, dispatch); err != nil {
				return err
			}
		}
		stage := snapshot.stage
		// A completed stage describes its original creation, not the current
		// business-table binding. Keep that evidence when adopting a replacement.
		if !snapshot.replacingCard || !stage.Done {
			stage.Done, stage.MessageID = true, messageID
		}
		found := false
		for i := range job.Payload.Stages {
			if job.Payload.Stages[i].Name == stage.Name {
				job.Payload.Stages[i], found = stage, true
				break
			}
		}
		if !found {
			job.Payload.Stages = append(job.Payload.Stages, stage)
		}
		job.Payload.HoldCreation = false
		job.Payload.Restored = false
		if job.State == OutputCancelled && job.Kind == OutputThreadEnsure && job.Payload.ThreadPurpose == "reminder_notice" && snapshot.otherID == "" {
			job.Payload.HoldCreation = true
		}
		for _, dispatch := range snapshot.detail.Dispatches {
			if dispatch.Outcome == DispatchUnknown && dispatch.ID != stage.CurrentDispatchID {
				job.Payload.HoldCreation = true
			}
		}
		if job.State != OutputCancelled {
			job.State, job.AvailableAt, job.LastError = OutputRetryWait, now, ""
			if job.Kind == OutputOperationLog || job.Kind == OutputReminderNotice || job.Kind == OutputListDeadlineNotice {
				job.State = OutputSucceeded
			}
		} else {
			job.LastError = "運用者による取消・作成結果確認済み"
			if job.Payload.HoldCreation {
				job.LastError = "取消済み・作成結果未確認"
			}
		}
		job.Executor, job.UpdatedAt = "", now
		actor, _ := OutputOperationFromContext(ctx)
		auditID, err := s.ids.NewID()
		if err != nil {
			return err
		}
		inserted, err := r.PutOperation(ctx, OperationRecord{ID: auditID, ChannelID: job.ChannelID, ActorID: actor.ActorID, Kind: "outputctl", Success: true, OccurredAt: now, Facts: OperationFacts{Message: action + " " + job.ID + " " + stage.Name + " " + messageID}})
		if err != nil {
			return err
		}
		if !inserted {
			return domain.Fail(domain.CodeConflict, auditID, "Audit was not recorded")
		}
		return r.PutOutput(ctx, job)
	})
}

func otherThreadStage(stage string) string {
	if stage == "parent" {
		return "thread"
	}
	return "parent"
}

func outputBinding(ctx context.Context, r Repository, job OutputTask, stage string, lock bool) (string, error) {
	var id *string
	switch job.Kind {
	case OutputListRender:
		list, err := r.GetList(ctx, job.ChannelID, lock)
		if err != nil {
			return "", err
		}
		if list != nil {
			id = list.Channel.MessageID
		}
	case OutputInventoryRender:
		catalog, err := r.GetCatalog(ctx, job.ChannelID, lock)
		if err != nil {
			return "", err
		}
		if catalog != nil {
			id = catalog.Channel.MessageID
		}
	case OutputTaskCard:
		if _, err := r.GetRemindChannel(ctx, job.ChannelID, lock); err != nil {
			return "", err
		}
		task, err := r.GetTask(ctx, job.ChannelID, job.TargetID, lock)
		if err != nil {
			return "", err
		}
		if task != nil {
			id = task.MessageID
		}
	case OutputListDeadlineNotice:
		if _, err := r.GetList(ctx, job.ChannelID, lock); err != nil {
			return "", err
		}
	case OutputReminderNotice:
		if _, err := r.GetRemindChannel(ctx, job.ChannelID, lock); err != nil {
			return "", err
		}
		if _, err := r.GetTask(ctx, job.ChannelID, job.TargetID, lock); err != nil {
			return "", err
		}
	case OutputThreadEnsure:
		if job.Payload.ThreadPurpose == "reminder_notice" && job.Payload.ChannelKind == "reminder" {
			channel, err := getRemind(ctx, r, job.ChannelID, lock)
			if err != nil {
				return "", err
			}
			id = channel.RemindNoticeThreadID
			if stage == "parent" {
				id = channel.RemindNoticeMessageID
			}
		} else if job.Payload.ThreadPurpose == "operation_log" && stage == "thread" {
			switch job.Payload.ChannelKind {
			case "list":
				list, err := getList(ctx, r, job.ChannelID, lock)
				if err != nil {
					return "", err
				}
				id = list.Channel.OperationLogThreadID
			case "inventory":
				catalog, err := getCatalog(ctx, r, job.ChannelID, lock)
				if err != nil {
					return "", err
				}
				id = catalog.Channel.OperationLogThreadID
			case "reminder":
				channel, err := getRemind(ctx, r, job.ChannelID, lock)
				if err != nil {
					return "", err
				}
				id = channel.OperationLogThreadID
			default:
				return "", domain.Fail(domain.CodeInvalidInput, "channelKind", "Invalid thread channel kind")
			}
		} else {
			return "", domain.Fail(domain.CodeInvalidInput, "purpose", "Invalid thread purpose")
		}
	}
	if id != nil {
		return *id, nil
	}
	return "", nil
}
