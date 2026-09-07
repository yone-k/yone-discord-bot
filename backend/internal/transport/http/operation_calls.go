package httptransport

import (
	"encoding/json"
	"slices"
)

// Keys are generated OpenAPI operation IDs. Input-path identities deliberately
// keep completion buttons and modals distinct, including their logging policy.
var businessCallKinds = map[string][]string{
	"AppendInventoryItems":   {"InventoryAddModalHandler", "AddInventoryCommand"},
	"CreateListChannel":      {"InitListCommand"},
	"PatchListChannel":       {"InitListCommand"},
	"DeleteListChannel":      {"InitListCommand"},
	"SaveList":               {"AddListModalHandler", "EditListModalHandler"},
	"AppendListItem":         {"AddListModalHandler", "AddListCommand"},
	"UpdateListItem":         {"EditListModalHandler", "reaction"},
	"DeleteListItem":         {"EditListModalHandler"},
	"ReorderList":            {"EditListModalHandler"},
	"CreateInventoryChannel": {"InitInventoryCommand"},
	"PatchInventoryChannel":  {"InitInventoryCommand"},
	"DeleteInventoryChannel": {"InitInventoryCommand"},
	"AppendInventoryItem":    {"InventoryAddModalHandler", "AddInventoryCommand"},
	"UpdateInventoryItem":    {"InventoryUpdateModalHandler", "UpdateInventoryCommand"},
	"BulkUpdateInventory":    {"InventoryUpdateModalHandler", "UpdateInventoryCommand"},
	"ApplyInventory":         {"InventoryUpdateModalHandler", "UpdateInventoryCommand"},
	"DeleteInventoryItem":    {"InventoryDeleteModalHandler", "DeleteInventoryCommand"},
	"ReorderInventory":       {"InventoryUpdateModalHandler", "UpdateInventoryCommand"},
	"ResolveInventory":       {"InventoryAddModalHandler", "AddInventoryCommand", "RemindTaskInventoryModalHandler", "AddRemindListCommand"},
	"CreateRemindChannel":    {"InitRemindListCommand", "RemindTaskAddModalHandler", "AddRemindListCommand"},
	"PatchRemindChannel":     {"InitRemindListCommand"},
	"DeleteRemindChannel":    {"InitRemindListCommand"},
	"LinkInventory":          {"LinkInventoryCommand", "UnlinkInventoryCommand"},
	"CreateTask":             {"RemindTaskAddModalHandler", "AddRemindListCommand"},
	"PatchTask":              {"RemindTaskUpdateModalHandler", "RemindTaskUpdateOverrideModalHandler"},
	"PauseTask":              {"RemindTaskUpdateOverrideModalHandler"},
	"ResumeTask":             {"RemindTaskUpdateOverrideModalHandler"},
	"EditTaskInventory":      {"RemindTaskInventoryModalHandler"},
	"DeleteTask":             {"RemindTaskDeleteModalHandler"},
	"ReorderTasks":           {"RemindTaskUpdateModalHandler"},
	"CompleteTask":           {"RemindTaskCompleteModalHandler", "RemindTaskCompleteButtonHandler"},
	"RequestDeleteAll":       {"ConfirmationModalHandler", "DeleteAllMessageCommand"},
	"InitializeOutputs":      {"InitListCommand", "InitInventoryCommand", "InitRemindListCommand"},
	"RedrawOutputs":          {"InitListButtonHandler", "InitListCommand", "InitInventoryCommand", "InitRemindListCommand"},
	"SetOutputCardView":      {"InventoryDeleteButtonHandler", "InventorySelectionCancelButtonHandler", "RemindTaskUpdateButtonHandler", "RemindTaskUpdateCancelButtonHandler", "RemindTaskUpdateSelectMenuHandler"},
}

func matchesBusinessCall(operationID, kind string, params map[string]string, body []byte) bool {
	// The event handler separately checks the body/header identity, including
	// the interaction ID. Every registered input path may report a UI outcome.
	if operationID == "RecordOutputEvent" {
		return true
	}
	if !slices.Contains(businessCallKinds[operationID], kind) {
		return false
	}
	if operationID != "InitializeOutputs" && operationID != "RedrawOutputs" && operationID != "SetOutputCardView" {
		return true
	}
	var input struct{ Kind, Mode string }
	if json.Unmarshal(body, &input) != nil {
		return false
	}
	if operationID != "SetOutputCardView" {
		switch kind {
		case "InitListCommand", "InitListButtonHandler":
			return input.Kind == "list"
		case "InitInventoryCommand":
			return input.Kind == "inventory"
		case "InitRemindListCommand":
			return input.Kind == "reminder"
		}
		return false
	}
	switch kind {
	case "InventoryDeleteButtonHandler":
		return params["targetKind"] == "inventory" && input.Mode == "delete_selection"
	case "InventorySelectionCancelButtonHandler":
		return params["targetKind"] == "inventory" && input.Mode == "normal"
	case "RemindTaskUpdateButtonHandler":
		return params["targetKind"] == "task" && input.Mode == "update_selection"
	case "RemindTaskUpdateCancelButtonHandler", "RemindTaskUpdateSelectMenuHandler":
		return params["targetKind"] == "task" && input.Mode == "normal"
	}
	return false
}
