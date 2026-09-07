package application

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestOutputOperationKeepsConcurrentActorsAndRejectsUnknownKinds(t *testing.T) {
	base := context.Background()
	one, err := WithOutputOperation(base, OutputOperation{ActorID: "123", Kind: "RemindTaskCompleteModalHandler", InteractionID: "interaction-1"})
	if err != nil {
		t.Fatal(err)
	}
	two, err := WithOutputOperation(base, OutputOperation{ActorID: "456", Kind: "RemindTaskCompleteButtonHandler", InteractionID: "interaction-2"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := OutputOperationFromContext(base); ok {
		t.Fatal("operation leaked into parent")
	}
	a, _ := OutputOperationFromContext(one)
	b, _ := OutputOperationFromContext(two)
	if a.ActorID != "123" || b.ActorID != "456" {
		t.Fatal("actors crossed requests")
	}
	da, _ := DescribeOutputOperation(a.Kind)
	db, _ := DescribeOutputOperation(b.Kind)
	if !da.PostLog || db.PostLog {
		t.Fatal("modal and button logging must remain distinct")
	}
	for _, op := range []OutputOperation{{ActorID: "123", Kind: "unknown"}, {Kind: "AddListModalHandler"}, {ActorID: "  ", Kind: "AddListModalHandler"}} {
		if _, err := WithOutputOperation(base, op); err == nil {
			t.Fatalf("accepted invalid operation: %#v", op)
		}
	}
}

func TestAuxiliaryOperationPreservesActorWithoutChangingParent(t *testing.T) {
	ctx, err := WithOutputOperation(t.Context(), OutputOperation{ActorID: "123", Kind: "RemindTaskAddModalHandler", InteractionID: "456"})
	if err != nil {
		t.Fatal(err)
	}
	aux, ok := OutputOperationFromContext(WithAuxiliaryOutputOperation(ctx))
	if !ok || !aux.auxiliary || aux.ActorID != "123" || aux.Kind != "RemindTaskAddModalHandler" || aux.InteractionID != "456" {
		t.Fatal(aux)
	}
	parent, _ := OutputOperationFromContext(ctx)
	if parent.auxiliary {
		t.Fatal("auxiliary role leaked to primary request")
	}
	if _, ok := OutputOperationFromContext(WithAuxiliaryOutputOperation(t.Context())); ok {
		t.Fatal("invented background actor")
	}
}

func TestOperationDescriptionsMatchLegacyLoggingFixtures(t *testing.T) {
	data, err := os.ReadFile("testdata/discord_outputs/legacy.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name  string
			Input struct {
				Info struct{ OperationType, ActionName string }
			}
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, c := range fixture.Cases {
		if !strings.HasPrefix(c.Name, "log-") || !strings.HasSuffix(c.Name, "-success") {
			continue
		}
		kind := OperationKind(strings.TrimSuffix(strings.TrimPrefix(c.Name, "log-"), "-success") + "Handler")
		info, ok := DescribeOutputOperation(kind)
		if !ok || !info.PostLog || info.Type != c.Input.Info.OperationType || info.Name != c.Input.Info.ActionName {
			t.Errorf("legacy mismatch for %s: %#v", kind, info)
		}
		count++
	}
	if count != 9 {
		t.Fatalf("expected all 9 legacy operations, got %d", count)
	}
}
