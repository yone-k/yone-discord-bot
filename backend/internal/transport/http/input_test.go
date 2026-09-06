package httptransport

import (
	"context"
	"errors"
	"github.com/oapi-codegen/nullable"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
	"testing"
)

func TestReminderAckRejectsDateOnlyDeadlineBeforeApplication(t *testing.T) {
	h := Handler{}
	_, err := h.AckNotification(context.Background(), api.AckNotificationRequestObject{Body: &api.NotificationToken{Kind: api.NotificationTokenKindBefore, EvaluatedAt: "2026-09-06T00:00:00.000Z", TargetDueAt: "2026-09-06", ExpectedRevision: nullable.NewNullableWithValue("1")}})
	if err == nil {
		t.Fatal("reminder ack accepted a date-only deadline")
	}
}

func TestListAckRejectsTimestampAndInvalidCalendarDateBeforeApplication(t *testing.T) {
	for _, deadline := range []string{"2026-09-06T00:00:00.000Z", "2026-02-30", "invalid"} {
		t.Run(deadline, func(t *testing.T) {
			h := Handler{}
			_, err := h.AckNotification(context.Background(), api.AckNotificationRequestObject{Body: &api.NotificationToken{Kind: api.NotificationTokenKindList, EvaluatedAt: "2026-09-06T00:00:00.000Z", TargetDueAt: deadline, ExpectedRevision: nullable.NewNullNullable[string]()}})
			if err == nil {
				t.Fatal("invalid list deadline accepted")
			}
		})
	}
}

func TestCompletionInputPreservesOmittedQuantityWithoutResolvingIt(t *testing.T) {
	values := []api.ConsumptionOverride{{Name: "soap", Consume: nullable.NewNullNullable[string]()}, {Name: "rice", Consume: nullable.NewNullableWithValue("0.123456789012345678901")}}
	got, e := inputOverrides(&values)
	if e != nil {
		t.Fatal(e)
	}
	if got[0].Name != "soap" || got[0].Consume != nil {
		t.Fatal("omitted consumption must remain unspecified for domain rules")
	}
	if got[1].Consume.String() != "0.123456789012345678901" {
		t.Fatal("precision lost")
	}
}

func TestApplyInputPreservesExistingIDAndOmittedNewID(t *testing.T) {
	id := "legacy/item"
	items, err := inputApplyInventoryItems([]api.ApplyInventoryItem{
		{Name: "new", Stock: "0.0000000000000000001", Category: nullable.NewNullNullable[string]()},
		{Id: &id, Name: "existing", Stock: "2", Category: nullable.NewNullableWithValue("food")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if items[0].ID != "" || items[0].Category != nil || items[0].Stock.String() != "0.0000000000000000001" {
		t.Fatalf("new item changed: %#v", items[0])
	}
	if items[1].ID != id || items[1].Category == nil || *items[1].Category != "food" {
		t.Fatalf("existing identity lost: %#v", items[1])
	}
}
func TestTaskManualOverrideRejectsInvalidDateAndPreservesNull(t *testing.T) {
	bad := "2026-02-30T00:00:00.000Z"
	for name, patch := range map[string]api.TaskPatch{
		"nextDueAt":  {NextDueAt: &bad},
		"lastDoneAt": {LastDoneAt: nullable.NewNullableWithValue(bad)},
	} {
		_, err := inputTaskPatch(patch)
		var failure *domain.Error
		if !errors.As(err, &failure) || failure.Target != name {
			t.Fatalf("%s did not identify the invalid field: %v", name, err)
		}
	}
	got, e := inputTaskPatch(api.TaskPatch{LastDoneAt: nullable.NewNullNullable[string]()})
	if e != nil {
		t.Fatal(e)
	}
	if !got.LastDoneAt.Present || got.LastDoneAt.Value != nil {
		t.Fatal("manual clear was lost")
	}
}
