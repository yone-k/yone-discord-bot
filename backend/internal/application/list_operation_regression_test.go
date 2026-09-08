package application

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type listLogRepository struct {
	Repository
	list       domain.List
	operations []OperationRecord
	outputs    []OutputTask
}

func (r *listLogRepository) GetList(context.Context, string, bool) (*domain.List, error) {
	copy := r.list
	return &copy, nil
}
func (r *listLogRepository) PutList(_ context.Context, list *domain.List) error {
	r.list = *list
	return nil
}
func (r *listLogRepository) PutOperation(_ context.Context, operation OperationRecord) (bool, error) {
	r.operations = append(r.operations, operation)
	return true, nil
}
func (r *listLogRepository) EnqueueOutput(_ context.Context, output OutputTask) (string, error) {
	r.outputs = append(r.outputs, output)
	return output.ID, nil
}

type listLogIDs struct{ next int }

func (ids *listLogIDs) NewID() (string, error) {
	ids.next++
	return fmt.Sprintf("id-%d", ids.next), nil
}

func TestListSaveCapturesAddedItemsInRenderedOperationLog(t *testing.T) {
	for _, kind := range []OperationKind{"AddListModalHandler", "EditListModalHandler"} {
		t.Run(string(kind), func(t *testing.T) {
			thread, category, until := "200", "食品", "2026-09-09"
			before := domain.ListItem{ID: "existing", Name: "既存の品"}
			repo := &listLogRepository{list: domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", OperationLogThreadID: &thread}, DefaultCategory: "その他", EditVersion: 4}, Items: []domain.ListItem{before}}}
			ctx, err := WithOutputOperation(t.Context(), OutputOperation{ActorID: "123", Kind: kind, InteractionID: "456"})
			if err != nil {
				t.Fatal(err)
			}
			s := New(readStore{repo}, &countingClock{time: time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)}, &listLogIDs{})
			items := []domain.ListItem{before, {Name: "牛乳", Category: &category, Until: &until}, {Name: "パン"}}
			if _, err := s.SaveList(ctx, "100", 4, items); err != nil {
				t.Fatal(err)
			}
			if len(repo.operations) != 1 {
				t.Fatalf("operations: %+v", repo.operations)
			}
			op := repo.operations[0]
			if len(op.Facts.Added) != 2 || len(op.Facts.Removed) != 0 || len(op.Facts.Modified) != 0 {
				t.Fatalf("facts: %+v", op.Facts)
			}
			text, err := FormatOperationLog(op)
			if err != nil {
				t.Fatal(err)
			}
			for _, expected := range []string{"<@123>", "結果: ✅ 成功", "- 追加項目:\n  • 牛乳 (食品) - 2026/09/09まで\n  • パン"} {
				if !strings.Contains(text, expected) {
					t.Fatalf("missing %q in %s", expected, text)
				}
			}
			if strings.Contains(text, before.Name) {
				t.Fatal("existing item included as added", text)
			}
			if repo.list.Items[2].Category != nil {
				t.Fatal("logging filled the stored category")
			}
			logs := 0
			for _, output := range repo.outputs {
				if output.Kind == OutputOperationLog {
					logs++
				}
			}
			if logs != 1 {
				t.Fatalf("operation logs: %d", logs)
			}
			if _, err := s.SaveList(ctx, "100", 4, items); err == nil {
				t.Fatal("stale version accepted")
			}
			if len(repo.operations) != 1 {
				t.Fatal("conflict recorded as another successful operation")
			}
		})
	}
}
