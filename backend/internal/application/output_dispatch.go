package application

import (
	"context"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// ExecuteOutput is the worker entry point for every persistent Discord effect.
// Each handler reloads and verifies execution ownership before touching Discord.
func (s *Service) ExecuteOutput(ctx context.Context, gateway DiscordGateway, botID string, job OutputTask, executor string) error {
	switch job.Kind {
	case OutputListRender, OutputInventoryRender, OutputTaskCard:
		return s.ExecuteCard(ctx, gateway, botID, job.ID, executor)
	case OutputReminderNotice, OutputListDeadlineNotice:
		return s.ExecuteNotification(ctx, gateway, botID, job.ID, executor)
	case OutputOperationLog:
		return s.ExecuteOperationLog(ctx, gateway, botID, job.ID, executor)
	case OutputThreadEnsure:
		return s.ExecuteThreadEnsure(ctx, gateway, botID, job.ID, executor)
	case OutputDeleteAll:
		return s.ExecuteDeleteAll(ctx, gateway, job.ID, executor)
	default:
		return domain.Fail(domain.CodeInvalidInput, job.ID, "Unsupported output kind")
	}
}
