package application

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// SetCardView serializes with business mutations on the channel parent. The
// display mode and its redraw request are committed as one unit.
func (s *Service) SetCardView(ctx context.Context, view CardView) (*CardView, error) {
	return write(s, ctx, func(r Repository) (*CardView, error) {
		var outputKind OutputKind
		var threadID *string
		switch view.TargetKind {
		case CardTask:
			if view.Mode != CardNormal && view.Mode != CardUpdateSelection || view.Page != 0 {
				return nil, domain.Fail(domain.CodeInvalidInput, "view", "Invalid task card view")
			}
			channel, err := getRemind(ctx, r, view.ChannelID, true)
			if err != nil {
				return nil, err
			}
			if _, err := getTask(ctx, r, view.ChannelID, view.TargetID, true); err != nil {
				return nil, err
			}
			outputKind, threadID = OutputTaskCard, channel.OperationLogThreadID
		case CardInventory:
			if view.TargetID != view.ChannelID || view.Mode != CardNormal && view.Mode != CardDeleteSelection {
				return nil, domain.Fail(domain.CodeInvalidInput, "view", "Invalid inventory card view")
			}
			catalog, err := getCatalog(ctx, r, view.ChannelID, true)
			if err != nil {
				return nil, err
			}
			view.Page = min(max(view.Page, 0), max(0, (len(catalog.Items)-1)/25))
			if view.Mode == CardNormal {
				view.Page = 0
			}
			outputKind, threadID = OutputInventoryRender, catalog.Channel.OperationLogThreadID
		default:
			return nil, domain.Fail(domain.CodeInvalidInput, "targetKind", "Invalid card target")
		}
		stored, err := r.PutCardView(ctx, view)
		if err != nil {
			return nil, err
		}
		if err := s.reserveBusinessOutput(ctx, r, view.ChannelID, view.TargetID, outputKind, threadID, OperationFacts{}, OutputPayload{}); err != nil {
			return nil, err
		}
		return &stored, nil
	})
}
