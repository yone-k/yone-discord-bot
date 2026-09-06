package generated

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// Compile-time field checks guard against emitter inheritance losing fields.
var _ = ListChannel{ChannelId: "legacy", EditVersion: "1", DefaultCategory: "other"}
var _ = InventoryChannel{ChannelId: "legacy", DefaultCategory: "other"}
var _ = InventoryEditItem{Id: "legacy", Name: "item", Stock: "0.1234567890123456789"}
var _ = StoredInventoryItem{Id: "legacy", ChannelId: "channel", Position: 1, Stock: "1"}
var _ = StoredRemindTask{Id: "legacy", ChannelId: "channel", Revision: "1", Title: "task", NextDueAt: "2026-09-06T00:00:00.000Z"}
var _ = Notification{Kind: "list", ChannelId: "channel", EvaluatedAt: "2026-09-06T00:00:00.000Z"}

func TestGeneratedDTOFieldsMatchContract(t *testing.T) {
	spec, err := GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	values := []any{
		ApiError{}, ApplyInventoryItem{}, ExpectedRevisionInput{}, Health{},
		LinkInventoryInput{}, ListChannelInput{}, ReorderInput{}, ResolveInventoryInput{}, Shortage{}, ShortageResult{},
		ListChannel{}, InventoryChannel{}, RemindChannel{}, ListChannelPatch{}, InventoryChannelPatch{}, RemindChannelPatch{},
		StoredListItem{}, ListEditItem{}, ListSnapshot{}, SaveListInput{}, InventoryItemInput{}, InventoryEditItem{}, StoredInventoryItem{},
		ApplyInventoryInput{}, BulkInventoryInput{}, InventoryConsumption{}, CreateTaskInput{}, StoredRemindTask{}, TaskPatch{}, PatchTaskInput{},
		CompleteTaskInput{}, ConsumptionOverride{}, RemindInventoryEdit{}, EditTaskInventoryInput{}, RemindInventoryEditResult{},
		TaskDisplay{}, ListDisplay{}, InventoryDisplay{}, Initialization{}, NotificationToken{}, Notification{}, ProgressUpdate{}, NotificationPlan{}, NotificationAckResult{},
	}
	checked := map[string]bool{}
	for _, value := range values {
		typ := reflect.TypeOf(value)
		checked[typ.Name()] = true
		ref := spec.Components.Schemas[typ.Name()]
		if ref == nil || ref.Value == nil {
			t.Errorf("generated DTO %s has no matching schema", typ.Name())
			continue
		}
		schema := ref.Value
		fields := map[string]bool{}
		for i := 0; i < typ.NumField(); i++ {
			fields[strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]] = true
		}
		for name := range schema.Properties {
			if !fields[name] {
				t.Errorf("%s loses property %s", typ.Name(), name)
			}
		}
	}
	for name, schema := range spec.Components.Schemas {
		// These TypeSpec spread templates are not referenced by any operation;
		// oapi-codegen omits them while emitting their fields in concrete DTOs.
		if name == "ChannelPatch" || name == "ChannelSettings" {
			continue
		}
		if schema.Value.Type != nil && schema.Value.Type.Is("object") && !checked[name] {
			t.Errorf("object schema %s has no generated DTO field check", name)
		}
	}
}

func TestNullablePatchPreservesAbsentNullAndValue(t *testing.T) {
	for _, input := range []string{`{}`, `{"messageId":null}`, `{"messageId":"legacy"}`} {
		var patch ListChannelPatch
		if err := json.Unmarshal([]byte(input), &patch); err != nil {
			t.Fatal(err)
		}
		output, err := json.Marshal(patch)
		if err != nil {
			t.Fatal(err)
		}
		if string(output) != input {
			t.Fatalf("%s became %s", input, output)
		}
	}
}
