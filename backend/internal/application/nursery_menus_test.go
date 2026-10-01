package application

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type nurseryMenuRepository struct {
	// Unused ports deliberately panic if the operation unexpectedly accesses them.
	Repository
	menus   map[string]domain.NurseryMenu
	channel *string
	posted  map[string]bool
	outputs []OutputTask
	locked  bool
}

func newNurseryMenuRepository() *nurseryMenuRepository {
	return &nurseryMenuRepository{menus: map[string]domain.NurseryMenu{}, posted: map[string]bool{}}
}

func (r *nurseryMenuRepository) GetNurseryMenu(_ context.Context, date string) (*domain.NurseryMenu, error) {
	menu, ok := r.menus[date]
	if !ok {
		return nil, nil
	}
	return &menu, nil
}
func (r *nurseryMenuRepository) NurseryMenus(_ context.Context, from, to string) ([]domain.NurseryMenu, error) {
	out := []domain.NurseryMenu{}
	for date, menu := range r.menus {
		if date >= from && date <= to {
			out = append(out, menu)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	return out, nil
}
func (r *nurseryMenuRepository) PutNurseryMenu(_ context.Context, menu domain.NurseryMenu) error {
	r.menus[menu.Date] = menu
	return nil
}
func (r *nurseryMenuRepository) DeleteNurseryMenu(_ context.Context, date string) error {
	delete(r.menus, date)
	return nil
}
func (r *nurseryMenuRepository) GetNurseryMenuChannel(context.Context) (*string, error) {
	return r.channel, nil
}
func (r *nurseryMenuRepository) PutNurseryMenuChannel(_ context.Context, channelID string, _ time.Time) error {
	r.channel = &channelID
	return nil
}
func (r *nurseryMenuRepository) NurseryMenuNoticeExists(_ context.Context, date string) (bool, error) {
	return r.posted[date], nil
}
func (r *nurseryMenuRepository) LockOutputQueue(context.Context) error {
	r.locked = true
	return nil
}
func (r *nurseryMenuRepository) EnqueueOutput(_ context.Context, task OutputTask) (string, error) {
	r.outputs = append(r.outputs, task)
	return task.ID, nil
}

type fixedClock struct{ time time.Time }

func (c fixedClock) Now() time.Time { return c.time }

type sequenceIDs struct{ next int }

func (s *sequenceIDs) NewID() (string, error) {
	s.next++
	return fmt.Sprintf("01992c1d-c100-7000-8000-%012d", s.next), nil
}

func nurseryService(repo *nurseryMenuRepository, now time.Time) *Service {
	return New(readStore{repo}, fixedClock{now}, &sequenceIDs{})
}

func failureCode(t *testing.T, err error, want domain.Code) {
	t.Helper()
	var failure *domain.Error
	if !errors.As(err, &failure) || failure.Code != want {
		t.Fatalf("want %s, got %v", want, err)
	}
}

func TestPutNurseryMenuCreatesThenReplacesKeepingCreatedAt(t *testing.T) {
	repo := newNurseryMenuRepository()
	created := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	menu, err := nurseryService(repo, created).PutNurseryMenu(context.Background(), "2026-10-02", " ご飯 ", "")
	if err != nil {
		t.Fatal(err)
	}
	if menu.Lunch != "ご飯" || !menu.CreatedAt.Equal(created) || !menu.UpdatedAt.Equal(created) {
		t.Fatalf("%+v", menu)
	}
	updated := created.Add(time.Hour)
	menu, err = nurseryService(repo, updated).PutNurseryMenu(context.Background(), "2026-10-02", "", "せんべい")
	if err != nil {
		t.Fatal(err)
	}
	if menu.Lunch != "" || menu.Snack != "せんべい" || !menu.CreatedAt.Equal(created) || !menu.UpdatedAt.Equal(updated) || repo.menus["2026-10-02"].Snack != "せんべい" {
		t.Fatalf("%+v", menu)
	}
}

func TestPutNurseryMenuIssuesAnIDOnCreateAndKeepsItOnReplace(t *testing.T) {
	repo := newNurseryMenuRepository()
	s := nurseryService(repo, time.Now())
	first, err := s.PutNurseryMenu(context.Background(), "2026-10-02", "ご飯", "")
	if err != nil || first.ID == "" {
		t.Fatal(first, err)
	}
	second, err := s.PutNurseryMenu(context.Background(), "2026-10-02", "パン", "")
	if err != nil || second.ID != first.ID || repo.menus["2026-10-02"].ID != first.ID {
		t.Fatal(first, second, err)
	}
	other, err := s.PutNurseryMenu(context.Background(), "2026-10-03", "ご飯", "")
	if err != nil || other.ID == first.ID {
		t.Fatal("a new date must receive its own ID", other, err)
	}
}

func TestPutNurseryMenusSavesNothingWhenAnyEntryIsInvalid(t *testing.T) {
	valid := NurseryMenuEntry{Date: "2026-10-02", Lunch: "ご飯"}
	tooMany := make([]NurseryMenuEntry, 63)
	for i := range tooMany {
		tooMany[i] = NurseryMenuEntry{Date: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, i).Format("2006-01-02"), Lunch: "ご飯"}
	}
	for name, entries := range map[string][]NurseryMenuEntry{
		"empty":          nil,
		"too many":       tooMany,
		"duplicate date": {valid, {Date: "2026-10-02", Snack: "牛乳"}},
		"invalid entry":  {valid, {Date: "2026-10-03"}},
		"invalid date":   {valid, {Date: "2026-02-30", Lunch: "ご飯"}},
	} {
		t.Run(name, func(t *testing.T) {
			repo := newNurseryMenuRepository()
			_, err := nurseryService(repo, time.Now()).PutNurseryMenus(context.Background(), entries)
			failureCode(t, err, domain.CodeInvalidInput)
			if len(repo.menus) != 0 {
				t.Fatal("an invalid batch saved menus", repo.menus)
			}
		})
	}
}

func TestPutNurseryMenusReturnsSavedMenusInDateOrder(t *testing.T) {
	repo := newNurseryMenuRepository()
	repo.menus["2026-10-09"] = domain.NurseryMenu{Date: "2026-10-09", Lunch: "untouched"}
	menus, err := nurseryService(repo, time.Now()).PutNurseryMenus(context.Background(), []NurseryMenuEntry{
		{Date: "2026-10-03", Snack: "牛乳"}, {Date: "2026-10-02", Lunch: "ご飯"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(menus) != 2 || menus[0].Date != "2026-10-02" || menus[1].Date != "2026-10-03" || len(repo.menus) != 3 || repo.menus["2026-10-09"].Lunch != "untouched" {
		t.Fatalf("%+v %+v", menus, repo.menus)
	}
}

func TestListNurseryMenusValidatesRange(t *testing.T) {
	repo := newNurseryMenuRepository()
	s := nurseryService(repo, time.Now())
	for name, r := range map[string][2]string{
		"reversed":     {"2026-10-02", "2026-10-01"},
		"63 days":      {"2026-10-01", "2026-12-02"},
		"invalid from": {"2026-02-30", "2026-03-01"},
		"invalid to":   {"2026-10-01", "2026-1-2"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := s.ListNurseryMenus(context.Background(), r[0], r[1])
			failureCode(t, err, domain.CodeInvalidInput)
		})
	}
	repo.menus["2026-10-01"] = domain.NurseryMenu{Date: "2026-10-01", Lunch: "a"}
	repo.menus["2026-12-01"] = domain.NurseryMenu{Date: "2026-12-01", Lunch: "b"}
	menus, err := s.ListNurseryMenus(context.Background(), "2026-10-01", "2026-12-01")
	if err != nil || len(menus) != 2 {
		t.Fatal("62-day inclusive range rejected", menus, err)
	}
}

func TestMissingNurseryMenuAndChannelAreNotFound(t *testing.T) {
	s := nurseryService(newNurseryMenuRepository(), time.Now())
	_, err := s.GetNurseryMenu(context.Background(), "2026-10-02")
	failureCode(t, err, domain.CodeNotFound)
	failureCode(t, s.DeleteNurseryMenu(context.Background(), "2026-10-02"), domain.CodeNotFound)
	_, err = s.GetNurseryMenuChannel(context.Background())
	failureCode(t, err, domain.CodeNotFound)
	_, err = s.GetNurseryMenu(context.Background(), "2026-13-01")
	failureCode(t, err, domain.CodeInvalidInput)
}

func TestDeleteNurseryMenuRemovesTheDay(t *testing.T) {
	repo := newNurseryMenuRepository()
	repo.menus["2026-10-02"] = domain.NurseryMenu{Date: "2026-10-02", Lunch: "ご飯"}
	if err := nurseryService(repo, time.Now()).DeleteNurseryMenu(context.Background(), "2026-10-02"); err != nil || len(repo.menus) != 0 {
		t.Fatal(err, repo.menus)
	}
}

func TestSetNurseryMenuChannelValidatesAndReplaces(t *testing.T) {
	repo := newNurseryMenuRepository()
	s := nurseryService(repo, time.Now())
	_, err := s.SetNurseryMenuChannel(context.Background(), "not-a-snowflake")
	failureCode(t, err, domain.CodeInvalidInput)
	for _, id := range []string{"100", "200"} {
		if _, err := s.SetNurseryMenuChannel(context.Background(), id); err != nil {
			t.Fatal(err)
		}
	}
	channel, err := s.GetNurseryMenuChannel(context.Background())
	if err != nil || channel != "200" {
		t.Fatal(channel, err)
	}
}

func TestNurseryMenuEntryLimitCountsCodePoints(t *testing.T) {
	repo := newNurseryMenuRepository()
	if _, err := nurseryService(repo, time.Now()).PutNurseryMenu(context.Background(), "2026-10-02", strings.Repeat("🍙", 1000), ""); err != nil {
		t.Fatal(err)
	}
}
