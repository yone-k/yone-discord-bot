package application

import (
	"context"
	"fmt"
	"strings"
)

// OperationKind identifies the input path, rather than the endpoint it happens
// to call. The completion button and completion modal intentionally differ.
type OperationKind string

type OutputOperation struct {
	ActorID       string
	Kind          OperationKind
	InteractionID string
	auxiliary     bool
}

type OperationDescription struct {
	Type, Name string
	PostLog    bool
}

var operationDescriptions = map[OperationKind]OperationDescription{
	"InitListButtonHandler":                 {"init", "リスト再描画", true},
	"AddListModalHandler":                   {"add", "アイテム追加", true},
	"EditListModalHandler":                  {"edit", "アイテム編集", true},
	"RemindTaskAddModalHandler":             {"add", "リマインド追加", true},
	"RemindTaskUpdateModalHandler":          {"update", "リマインド更新", true},
	"RemindTaskUpdateOverrideModalHandler":  {"update", "リマインド詳細設定", true},
	"RemindTaskInventoryModalHandler":       {"update", "在庫設定", true},
	"RemindTaskCompleteModalHandler":        {"complete", "リマインド完了", true},
	"RemindTaskDeleteModalHandler":          {"delete", "リマインド削除", true},
	"AddListButtonHandler":                  {"add", "アイテム追加", false},
	"EditListButtonHandler":                 {"edit", "アイテム編集", false},
	"ConfirmationModalHandler":              {"confirmation", "確認処理", false},
	"RemindTaskUpdateButtonHandler":         {"update", "リマインド更新", false},
	"RemindTaskUpdateCancelButtonHandler":   {"update", "リマインド更新キャンセル", false},
	"RemindTaskCompleteButtonHandler":       {"complete", "リマインド完了", false},
	"RemindTaskDeleteButtonHandler":         {"delete", "リマインド削除", false},
	"RemindTaskDetailButtonHandler":         {"detail", "リマインド詳細", false},
	"RemindTaskAddButtonHandler":            {"add", "リマインド追加", false},
	"InventoryAddButtonHandler":             {"add", "在庫アイテム追加", false},
	"InventoryUpdateButtonHandler":          {"update", "在庫アイテム更新", false},
	"InventoryDeleteButtonHandler":          {"delete", "在庫アイテム削除", false},
	"InventorySelectionCancelButtonHandler": {"update", "在庫選択キャンセル", false},
	"InventoryAddModalHandler":              {"add", "在庫アイテム追加", false},
	"InventoryUpdateModalHandler":           {"update", "在庫アイテム更新", false},
	"InventoryDeleteModalHandler":           {"delete", "在庫アイテム削除", false},
	"InventoryDeleteSelectMenuHandler":      {"delete", "在庫アイテム削除", false},
	"RemindTaskUpdateSelectMenuHandler":     {"update", "リマインド更新", false},
	"InitListCommand":                       {"init", "リスト初期化", false},
	"InitInventoryCommand":                  {"init", "在庫初期化", false},
	"InitRemindListCommand":                 {"init", "リマインド初期化", false},
	"AddListCommand":                        {"add", "アイテム追加", false},
	"AddInventoryCommand":                   {"add", "在庫アイテム追加", false},
	"UpdateInventoryCommand":                {"update", "在庫アイテム更新", false},
	"DeleteInventoryCommand":                {"delete", "在庫アイテム削除", false},
	"AddRemindListCommand":                  {"add", "リマインド追加", false},
	"LinkInventoryCommand":                  {"update", "在庫連動", false},
	"UnlinkInventoryCommand":                {"update", "在庫連動解除", false},
	"DeleteAllMessageCommand":               {"delete", "全メッセージ削除", false},
	"reaction":                              {"update", "リアクション", false},
	"outputctl":                             {"output", "出力管理", false},
}

func DescribeOutputOperation(kind OperationKind) (OperationDescription, bool) {
	value, ok := operationDescriptions[kind]
	return value, ok
}

type outputOperationKey struct{}

// WithOutputOperation stores a value copy in this request only. Internal worker
// operations leave it absent; no invented actor is attached to background work.
func WithOutputOperation(ctx context.Context, op OutputOperation) (context.Context, error) {
	if strings.TrimSpace(op.ActorID) == "" {
		return nil, fmt.Errorf("output operation actor is required")
	}
	if _, ok := DescribeOutputOperation(op.Kind); !ok {
		return nil, fmt.Errorf("unknown output operation kind")
	}
	return context.WithValue(ctx, outputOperationKey{}, op), nil
}

func OutputOperationFromContext(ctx context.Context) (OutputOperation, bool) {
	op, ok := ctx.Value(outputOperationKey{}).(OutputOperation)
	return op, ok
}

// WithAuxiliaryOutputOperation keeps the real actor for rejection reporting,
// while leaving successful completion to the later primary call.
func WithAuxiliaryOutputOperation(ctx context.Context) context.Context {
	op, ok := OutputOperationFromContext(ctx)
	if !ok {
		return ctx
	}
	op.auxiliary = true
	return context.WithValue(ctx, outputOperationKey{}, op)
}
