package application

import "context"

type outputChannel struct{ id, kind string }

// ReserveStartupOutputs runs after recovery and before dispatch starts. Each
// channel uses a separate transaction so unrelated business parents are never
// locked together. Restart resets selection but does not remove suspensions.
func (s *Service) ReserveStartupOutputs(ctx context.Context) error {
	channels, err := read(s, ctx, func(r Repository) ([]outputChannel, error) {
		out := []outputChannel{}
		lists, err := r.Lists(ctx)
		if err != nil {
			return nil, err
		}
		for _, c := range lists {
			out = append(out, outputChannel{c.ChannelID, "list"})
		}
		catalogs, err := r.Catalogs(ctx)
		if err != nil {
			return nil, err
		}
		for _, c := range catalogs {
			out = append(out, outputChannel{c.ChannelID, "inventory"})
		}
		reminders, err := r.RemindChannels(ctx)
		if err != nil {
			return nil, err
		}
		for _, c := range reminders {
			out = append(out, outputChannel{c.ChannelID, "reminder"})
		}
		return out, nil
	})
	if err != nil {
		return err
	}
	for _, channel := range channels {
		if err := s.store.Write(ctx, func(r Repository) error { return s.reserveStartupChannel(ctx, r, channel, "") }); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reserveStartupChannel(ctx context.Context, r Repository, channel outputChannel, operationID string) error {
	var logThread *string
	switch channel.kind {
	case "list":
		list, err := r.GetList(ctx, channel.id, true)
		if err != nil {
			return err
		}
		if list == nil {
			return nil
		}
		logThread = list.Channel.OperationLogThreadID
		if err := s.reserveCardOutput(ctx, r, channel.id, channel.id, OutputListRender, operationID, OutputPayload{PinMessage: true}); err != nil {
			return err
		}
	case "inventory":
		catalog, err := r.GetCatalog(ctx, channel.id, true)
		if err != nil {
			return err
		}
		if catalog == nil {
			return nil
		}
		logThread = catalog.Channel.OperationLogThreadID
		if _, err := r.PutCardView(ctx, CardView{ChannelID: channel.id, TargetKind: CardInventory, TargetID: channel.id, Mode: CardNormal}); err != nil {
			return err
		}
		if err := s.reserveCardOutput(ctx, r, channel.id, channel.id, OutputInventoryRender, operationID, OutputPayload{}); err != nil {
			return err
		}
	case "reminder":
		reminder, err := r.GetRemindChannel(ctx, channel.id, true)
		if err != nil {
			return err
		}
		if reminder == nil {
			return nil
		}
		logThread = reminder.OperationLogThreadID
		if err := s.reserveThreadEnsure(ctx, r, channel, "reminder_notice", false); err != nil {
			return err
		}
		tasks, err := r.Tasks(ctx, channel.id, false)
		if err != nil {
			return err
		}
		for _, task := range tasks {
			if _, err := r.PutCardView(ctx, CardView{ChannelID: channel.id, TargetKind: CardTask, TargetID: task.ID, Mode: CardNormal}); err != nil {
				return err
			}
			if err := s.reserveCardOutput(ctx, r, channel.id, task.ID, OutputTaskCard, operationID, OutputPayload{}); err != nil {
				return err
			}
		}
	}
	if logThread != nil {
		return s.reserveThreadEnsure(ctx, r, channel, "operation_log", false)
	}
	return nil
}

// The caller holds the settings parent lock, which serializes reservations for
// this destination. Existing uncertain/blocked tasks retain their evidence.
func (s *Service) reserveThreadEnsure(ctx context.Context, r Repository, channel outputChannel, purpose string, allowCreate bool) error {
	_, err := s.reserveThreadEnsureID(ctx, r, channel, purpose, allowCreate)
	return err
}

func (s *Service) reserveThreadEnsureID(ctx context.Context, r Repository, channel outputChannel, purpose string, allowCreate bool) (string, error) {
	target := channel.kind + ":" + purpose
	jobs, err := r.ListOutputs(ctx, OutputFilter{ChannelID: channel.id})
	if err != nil {
		return "", err
	}
	for _, job := range jobs {
		if job.Kind == OutputThreadEnsure && job.TargetID == target && !outputTerminal(job.State) {
			return job.ID, nil
		}
	}
	id, err := s.ids.NewID()
	if err != nil {
		return "", err
	}
	now := s.now()
	state, reason := OutputPending, ""
	if purpose == "reminder_notice" && !allowCreate {
		settings, err := getRemind(ctx, r, channel.id, false)
		if err != nil {
			return "", err
		}
		if settings.RemindNoticeMessageID == nil || settings.RemindNoticeThreadID == nil {
			state, reason = OutputUncertain, "既存通知先の所在不明"
		}
	}
	return r.EnqueueOutput(ctx, OutputTask{ID: id, ChannelID: channel.id, Kind: OutputThreadEnsure, TargetID: target, DestinationKey: "thread_ensure:" + target, State: state, LastError: reason, AvailableAt: now, CreatedAt: now, UpdatedAt: now, Payload: OutputPayload{ThreadPurpose: purpose, ChannelKind: channel.kind, AllowCreate: allowCreate}})
}
