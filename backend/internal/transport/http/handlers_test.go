package httptransport

import (
	"context"
	"errors"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	api "github.com/yone-k/yone-discord-bot/backend/internal/transport/http/generated"
	"testing"
	"time"
)

type handlerStore struct {
	repository    application.Repository
	reads, writes int
}

func (s *handlerStore) Read(ctx context.Context, fn func(application.Repository) error) error {
	s.reads++
	return fn(s.repository)
}
func (s *handlerStore) Write(ctx context.Context, fn func(application.Repository) error) error {
	s.writes++
	return fn(s.repository)
}

type handlerRepository struct {
	application.Repository
	list    *domain.List
	catalog *domain.InventoryCatalog
	outputs []application.OutputTask
}

func (r *handlerRepository) EnqueueOutput(_ context.Context, task application.OutputTask) (string, error) {
	r.outputs = append(r.outputs, task)
	return task.ID, nil
}

type handlerClock struct{}

func (handlerClock) Now() time.Time { return time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC) }

func (r *handlerRepository) GetList(context.Context, string, bool) (*domain.List, error) {
	return r.list, nil
}
func (r *handlerRepository) PutList(_ context.Context, v *domain.List) error { r.list = v; return nil }
func (r *handlerRepository) GetCatalog(context.Context, string, bool) (*domain.InventoryCatalog, error) {
	return r.catalog, nil
}
func (r *handlerRepository) PutCatalog(_ context.Context, v *domain.InventoryCatalog) error {
	r.catalog = v
	return nil
}

type handlerIDs struct{}

func (handlerIDs) NewID() (string, error) { return "01992c1d-c100-7000-8000-000000000001", nil }

func TestHandlerApplicationRoundTripPreservesStockPrecisionAndLegacyID(t *testing.T) {
	q, e := domain.ParseQuantity("0.123456789012345678901")
	if e != nil {
		t.Fatal(e)
	}
	repo := &handlerRepository{catalog: &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "1", ListTitle: "inventory"}, DefaultCategory: "other"}, Items: []domain.InventoryItem{{ID: "arbitrary-old-id", ChannelID: "1", Name: "item", Stock: q}}}}
	store := &handlerStore{repository: repo}
	h := Handler{Service: application.New(store, handlerClock{}, handlerIDs{})}
	response, e := h.GetInventoryItems(context.Background(), api.GetInventoryItemsRequestObject{ChannelId: "1"})
	if e != nil {
		t.Fatal(e)
	}
	rows := response.(api.GetInventoryItems200JSONResponse)
	if len(rows) != 1 || rows[0].Id != "arbitrary-old-id" || rows[0].Stock != "0.123456789012345678901" {
		t.Fatalf("lost stored data: %#v", rows)
	}
	if store.reads != 1 || store.writes != 0 {
		t.Fatalf("unexpected unit of work: %#v", store)
	}
}
func TestHandlerChannelWritesPreserveOutputMessageID(t *testing.T) {
	message := "99"
	repo := &handlerRepository{list: &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "1", ListTitle: "list", MessageID: &message}, DefaultCategory: "other"}}}
	store := &handlerStore{repository: repo}
	h := Handler{Service: application.New(store, handlerClock{}, handlerIDs{})}
	if _, e := h.PatchListChannel(context.Background(), api.PatchListChannelRequestObject{ChannelId: "1", Body: &api.ListChannelPatch{}}); e != nil {
		t.Fatal(e)
	}
	if repo.list.Channel.MessageID == nil || *repo.list.Channel.MessageID != "99" {
		t.Fatal("omission cleared message")
	}
	if _, e := h.CreateListChannel(context.Background(), api.CreateListChannelRequestObject{ChannelId: "1", Body: &api.ListChannelInput{ChannelId: "1", ListTitle: "new title", DefaultCategory: "other"}}); e != nil {
		t.Fatal(e)
	}
	if repo.list.Channel.MessageID == nil || *repo.list.Channel.MessageID != "99" || repo.list.Channel.ListTitle != "new title" {
		t.Fatal("settings save lost output identity or title")
	}
}

func TestHandlerRejectsMismatchedChannelBeforeCallingApplication(t *testing.T) {
	h := Handler{}
	_, err := h.CreateListChannel(context.Background(), api.CreateListChannelRequestObject{ChannelId: "1", Body: &api.ListChannelInput{ChannelId: "2"}})
	var failure *domain.Error
	if !errors.As(err, &failure) || failure.Code != "invalid_input" {
		t.Fatalf("expected invalid_input, got %v", err)
	}
}
func TestHandlerRejectsNonDecimalBeforeCallingApplication(t *testing.T) {
	h := Handler{}
	_, err := h.AppendInventoryItem(context.Background(), api.AppendInventoryItemRequestObject{ChannelId: "1", Body: &api.InventoryItemInput{Name: "item", Stock: "1e2"}})
	var failure *domain.Error
	if !errors.As(err, &failure) || failure.Code != "invalid_input" {
		t.Fatalf("expected invalid_input, got %v", err)
	}
}
func TestHandlerDoesNotInventHealthReadiness(t *testing.T) {
	h := Handler{Check: func(context.Context) error { return errors.New("offline") }}
	response, err := h.Health(context.Background(), api.HealthRequestObject{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := response.(api.Health503JSONResponse); !ok {
		t.Fatalf("expected unavailable, got %T", response)
	}
}
