package application

import (
	"context"
	"errors"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// BusinessRejectionMessage mirrors CoreClient's user-facing business errors.
// Transport/storage failures are not proof that a business mutation failed.
func BusinessRejectionMessage(cause error) (string, bool) {
	var failure *domain.Error
	if !errors.As(cause, &failure) {
		return "", false
	}
	message := ""
	switch failure.Code {
	case domain.CodeConflict:
		message = "他の操作で内容が更新されました。画面を開き直してください。"
	case domain.CodeNotFound:
		message = "対象が見つかりません。画面を開き直してください。"
	case domain.CodeInvalidInput:
		message = "入力内容を確認してください。"
		if failure.Reason == domain.ReasonDuplicateName {
			return "同名のアイテムが既に存在します", true
		}
		switch failure.Target {
		case "quantity":
			message = "数量は0以上の数値で入力してください。"
		case "lastDoneAt":
			message = "前回完了日時を確認してください。"
		case "nextDueAt":
			message = "次回期限を確認してください。"
		}
	case domain.CodeReferenced:
		message = "他の項目から参照されているため変更できません。"
	case domain.CodeShortage:
		message = "在庫が不足しています。"
	default:
		return "", false
	}
	var details *OperationError
	if errors.As(cause, &details) {
		if failure.Code == domain.CodeReferenced {
			for _, task := range details.References {
				message += "\n- " + task.ChannelID + ": " + task.Title
			}
		}
		if failure.Code == domain.CodeShortage {
			for _, shortage := range details.Shortages {
				missing := domain.Quantity{}
				if shortage.Required.Compare(shortage.Available) > 0 {
					var err error
					missing, err = shortage.Required.Subtract(shortage.Available)
					if err != nil {
						return "", false
					}
				}
				message += "\n" + shortage.Name + ": " + formatDisplayQuantity(missing) + "個不足"
			}
		}
	}
	return message, true
}

// RecordBusinessRejection must be called only after the business transaction
// has rolled back. Returning a recording error lets the caller report it in
// operational logs without changing the original business result.
func (s *Service) RecordBusinessRejection(ctx context.Context, channel string, cause error) error {
	actor, ok := OutputOperationFromContext(ctx)
	if !ok {
		return nil
	}
	message, rejected := BusinessRejectionMessage(cause)
	if !rejected {
		return nil
	}
	if !discordID.MatchString(actor.ActorID) || !discordID.MatchString(channel) {
		return domain.Fail(domain.CodeInvalidInput, "actor", "Invalid operation identity")
	}
	_, err := s.recordOutputOutcome(ctx, OutputLogEvent{ActorID: actor.ActorID, ChannelID: channel, OperationKind: actor.Kind, InteractionID: actor.InteractionID, OccurredAt: s.now(), Message: message})
	return err
}
