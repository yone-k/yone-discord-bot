package application

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

// FormatOperationLog uses facts and time captured when the operation completed,
// rather than the worker's eventual delivery time.
func FormatOperationLog(record OperationRecord) (string, error) {
	info, ok := DescribeOutputOperation(record.Kind)
	if !ok {
		return "", fmt.Errorf("unknown output operation kind")
	}
	var out strings.Builder
	fmt.Fprintf(&out, "[%s] <@%s>\n操作: %s - %s\n", record.OccurredAt.In(domain.Tokyo).Format("2006/01/02 15:04:05"), record.ActorID, info.Type, info.Name)
	if record.Success {
		out.WriteString("結果: ✅ 成功\n")
	} else {
		out.WriteString("結果: ❌ 失敗\n")
		if record.Facts.Message != "" {
			fmt.Fprintf(&out, "エラー: %s\n", record.Facts.Message)
		}
	}
	var details strings.Builder
	facts := record.Facts
	if len(facts.Added) > 0 {
		details.WriteString("- 追加項目:\n")
		for _, item := range facts.Added {
			fmt.Fprintf(&details, "  • %s", item.Name)
			if item.Category != "" {
				fmt.Fprintf(&details, " (%s)", item.Category)
			}
			if item.Until != nil {
				fmt.Fprintf(&details, " - %sまで", logDate(item.Until))
			}
			details.WriteByte('\n')
		}
	}
	if len(facts.Removed) > 0 {
		details.WriteString("- 削除項目:\n")
		for _, item := range facts.Removed {
			fmt.Fprintf(&details, "  • %s", item.Name)
			if item.Category != "" {
				fmt.Fprintf(&details, " (%s)", item.Category)
			}
			details.WriteByte('\n')
		}
	}
	if len(facts.Modified) > 0 {
		details.WriteString("- 変更項目:\n")
		for _, change := range facts.Modified {
			fmt.Fprintf(&details, "  • %s:\n", change.Name)
			if change.CheckPresent {
				fmt.Fprintf(&details, "    完了状態: %s → %s\n", logChecked(change.Before.Check), logChecked(change.After.Check))
			}
			if change.CategoryPresent {
				fmt.Fprintf(&details, "    カテゴリ: %s → %s\n", logCategory(change.Before.Category), logCategory(change.After.Category))
			}
			if change.UntilPresent {
				fmt.Fprintf(&details, "    期限: %s → %s\n", logDate(change.Before.Until), logDate(change.After.Until))
			}
		}
	}
	if facts.LegacyBefore != "" && facts.LegacyAfter != "" {
		before, err := compactLogJSON(facts.LegacyBefore)
		if err != nil {
			return "", err
		}
		after, err := compactLogJSON(facts.LegacyAfter)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&details, "- 変更前: %s\n- 変更後: %s\n", before, after)
	}
	if facts.CancelReason != "" {
		fmt.Fprintf(&details, "- キャンセル理由: %s\n", facts.CancelReason)
	}
	if details.Len() > 0 {
		out.WriteString("詳細:\n")
		out.WriteString(details.String())
	}
	return strings.TrimSpace(out.String()), nil
}

func logDate(value *time.Time) string {
	if value == nil {
		return "未設定"
	}
	return value.In(domain.Tokyo).Format("2006/01/02")
}
func logChecked(value bool) string {
	if value {
		return "完了"
	}
	return "未完了"
}
func logCategory(value string) string {
	if value == "" {
		return "未設定"
	}
	return value
}
func compactLogJSON(value string) (string, error) {
	var out bytes.Buffer
	if err := json.Compact(&out, []byte(value)); err != nil {
		return "", fmt.Errorf("invalid legacy operation facts")
	}
	return out.String(), nil
}
