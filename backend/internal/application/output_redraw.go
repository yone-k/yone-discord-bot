package application

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// RedrawOutputs keeps both the selected view and any channel suspension. Unlike
// initialization it neither creates thread intents nor changes logging settings.
func (s *Service) RedrawOutputs(ctx context.Context, channel, kind string) ([]string, error) {
	return write(s, ctx, func(r Repository) ([]string, error) {
		switch kind {
		case "list":
			list, err := getList(ctx, r, channel, true)
			if err != nil {
				return nil, err
			}
			if err := s.reserveBusinessOutput(ctx, r, channel, channel, OutputListRender, list.Channel.OperationLogThreadID, OperationFacts{}, OutputPayload{}); err != nil {
				return nil, err
			}
		case "inventory":
			catalog, err := getCatalog(ctx, r, channel, true)
			if err != nil {
				return nil, err
			}
			if err := s.reserveBusinessOutput(ctx, r, channel, channel, OutputInventoryRender, catalog.Channel.OperationLogThreadID, OperationFacts{}, OutputPayload{}); err != nil {
				return nil, err
			}
		case "reminder":
			reminder, err := getRemind(ctx, r, channel, true)
			if err != nil {
				return nil, err
			}
			if err := s.reserveReminderCards(ctx, r, reminder); err != nil {
				return nil, err
			}
		default:
			return nil, domain.Fail(domain.CodeInvalidInput, "kind", "Invalid redraw kind")
		}
		jobs, err := r.ListOutputs(ctx, OutputFilter{ChannelID: channel})
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
