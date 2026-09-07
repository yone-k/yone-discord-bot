package application

import (
	"errors"
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestBusinessRejectionMessageUsesSafeJapaneseContract(t *testing.T) {
	for _, tc := range []struct {
		err     error
		message string
	}{
		{domain.Fail(domain.CodeConflict, "revision", "private diagnostic"), "他の操作で内容が更新されました。画面を開き直してください。"},
		{domain.Fail(domain.CodeInvalidInput, "quantity", "private diagnostic"), "数量は0以上の数値で入力してください。"},
		{domain.DuplicateName("milk"), "同名のアイテムが既に存在します"},
		{&OperationError{Cause: domain.Fail(domain.CodeReferenced, "id", "private diagnostic"), References: []domain.RemindTask{{ChannelID: "100", Title: "買い物"}}}, "他の項目から参照されているため変更できません。\n- 100: 買い物"},
		{errors.New("connection lost with private DSN"), ""},
	} {
		got, known := BusinessRejectionMessage(tc.err)
		if got != tc.message || known != (tc.message != "") {
			t.Fatalf("message=%q known=%v", got, known)
		}
	}
}
