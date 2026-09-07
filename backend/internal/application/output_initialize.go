package application

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func (s *Service) InitializeOutputs(ctx context.Context, channel, kind string, enableLog *bool) ([]string, error) {
	if kind != "list" && kind != "inventory" && kind != "reminder" || enableLog != nil && kind != "list" {
		return nil, domain.Fail(domain.CodeInvalidInput, "kind", "Invalid initialization request")
	}
	return write(s, ctx, func(r Repository) ([]string, error) {
		// Serialize with claim/recovery and deletion reservation. Parent lock
		// order matches task mutations that may then update linked inventory.
		if err := r.LockOutputQueue(ctx); err != nil {
			return nil, err
		}
		reminder, err := r.GetRemindChannel(ctx, channel, true)
		if err != nil {
			return nil, err
		}
		inventory, err := r.GetCatalog(ctx, channel, true)
		if err != nil {
			return nil, err
		}
		list, err := r.GetList(ctx, channel, true)
		if err != nil {
			return nil, err
		}
		if kind == "list" && list == nil || kind == "inventory" && inventory == nil || kind == "reminder" && reminder == nil {
			return nil, domain.Fail(domain.CodeNotFound, channel, "Channel is not configured")
		}
		jobs, err := r.ListOutputs(ctx, OutputFilter{ChannelID: channel})
		if err != nil {
			return nil, err
		}
		for _, job := range jobs {
			if job.Kind == OutputDeleteAll && !outputTerminal(job.State) {
				return nil, domain.Fail(domain.CodeConflict, job.ID, "Message deletion has not finished")
			}
		}
		if enableLog != nil {
			if *enableLog {
				if err := s.reserveThreadEnsure(ctx, r, outputChannel{channel, "list"}, "operation_log", true); err != nil {
					return nil, err
				}
			} else {
				list.Channel.OperationLogThreadID = nil
				if err := r.PutList(ctx, list); err != nil {
					return nil, err
				}
				if err := s.disableLogCreation(ctx, r, jobs); err != nil {
					return nil, err
				}
			}
		}
		operationID, err := s.reserveBusinessOperation(ctx, r, channel, nil, OperationFacts{})
		if err != nil {
			return nil, err
		}
		kinds := []string{}
		if reminder != nil {
			kinds = append(kinds, "reminder")
		}
		if inventory != nil {
			kinds = append(kinds, "inventory")
		}
		if list != nil {
			kinds = append(kinds, "list")
		}
		for _, current := range kinds {
			if err := s.reserveStartupChannel(ctx, r, outputChannel{channel, current}, operationID); err != nil {
				return nil, err
			}
		}
		if err := r.DeleteSuspension(ctx, channel); err != nil {
			return nil, err
		}
		jobs, err = r.ListOutputs(ctx, OutputFilter{ChannelID: channel})
		if err != nil {
			return nil, err
		}
		ids := []string{}
		for _, job := range jobs {
			if !outputTerminal(job.State) {
				ids = append(ids, job.ID)
			}
		}
		return ids, nil
	})
}

func (s *Service) disableLogCreation(ctx context.Context, r Repository, jobs []OutputTask) error {
	for _, candidate := range jobs {
		if candidate.Kind != OutputThreadEnsure || candidate.Payload.ChannelKind != "list" || candidate.Payload.ThreadPurpose != "operation_log" || outputTerminal(candidate.State) {
			continue
		}
		job, err := r.GetOutput(ctx, candidate.ID, true)
		if err != nil {
			return err
		}
		if job == nil || outputTerminal(job.State) {
			continue
		}
		history, err := r.OutputDispatches(ctx, job.ID)
		if err != nil {
			return err
		}
		unknown := job.State == OutputUncertain
		for _, dispatch := range history {
			if dispatch.Outcome == DispatchUnknown {
				unknown = true
			}
		}
		job.State = OutputCancelled
		job.LastError = "操作ログを無効化"
		if unknown {
			job.State, job.LastError = OutputUncertain, "操作ログ無効化時に作成結果が未確認"
		}
		job.Executor, job.UpdatedAt = "", s.now()
		if err := r.PutOutput(ctx, *job); err != nil {
			return err
		}
	}
	return nil
}
