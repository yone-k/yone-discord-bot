//go:build integration

package repository_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/repository"
)

func nmWrite(t *testing.T, store *repository.Store, fn func(application.Repository) error) {
	t.Helper()
	if err := store.Write(t.Context(), fn); err != nil {
		t.Fatal(err)
	}
}

func TestNurseryMenusRoundTripRangeAndDelete(t *testing.T) {
	_, store := rpSetup(t)
	created := time.Date(2026, 10, 1, 0, 0, 0, 123000000, time.UTC)
	updated := created.Add(time.Hour)
	replaced := rpID()
	nmWrite(t, store, func(r application.Repository) error {
		for _, menu := range []domain.NurseryMenu{
			{ID: rpID(), Date: "2026-10-01", Lunch: "ご飯\n味噌汁", CreatedAt: created, UpdatedAt: created},
			{ID: replaced, Date: "2026-10-03", Snack: "牛乳", CreatedAt: created, UpdatedAt: created},
			{ID: rpID(), Date: "2026-10-05", Lunch: "outside", CreatedAt: created, UpdatedAt: created},
		} {
			if err := r.PutNurseryMenu(t.Context(), menu); err != nil {
				return err
			}
		}
		return r.PutNurseryMenu(t.Context(), domain.NurseryMenu{ID: replaced, Date: "2026-10-03", Lunch: "パン", CreatedAt: created, UpdatedAt: updated})
	})
	if err := store.Read(t.Context(), func(r application.Repository) error {
		menu, err := r.GetNurseryMenu(t.Context(), "2026-10-03")
		if err != nil {
			return err
		}
		rpEqual(t, &domain.NurseryMenu{ID: replaced, Date: "2026-10-03", Lunch: "パン", CreatedAt: created, UpdatedAt: updated}, menu)
		missing, err := r.GetNurseryMenu(t.Context(), "2026-10-02")
		if err != nil || missing != nil {
			t.Fatal("missing menu", missing, err)
		}
		menus, err := r.NurseryMenus(t.Context(), "2026-10-01", "2026-10-03")
		if err != nil {
			return err
		}
		if len(menus) != 2 || menus[0].Date != "2026-10-01" || menus[0].Lunch != "ご飯\n味噌汁" || menus[1].Date != "2026-10-03" {
			t.Fatalf("%+v", menus)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	nmWrite(t, store, func(r application.Repository) error { return r.DeleteNurseryMenu(t.Context(), "2026-10-01") })
	if err := store.Read(t.Context(), func(r application.Repository) error {
		menus, err := r.NurseryMenus(t.Context(), "2026-10-01", "2026-10-31")
		if err == nil && len(menus) != 2 {
			t.Fatalf("%+v", menus)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func TestNurseryMenuIngredientsRoundTripAndClearOnReplace(t *testing.T) {
	_, store := rpSetup(t)
	at := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	id := rpID()
	read := func() *domain.NurseryMenu {
		var menu *domain.NurseryMenu
		rpRead(t, store, func(r application.Repository) (err error) {
			menu, err = r.GetNurseryMenu(t.Context(), "2026-10-02")
			return
		})
		return menu
	}
	nmWrite(t, store, func(r application.Repository) error {
		return r.PutNurseryMenu(t.Context(), domain.NurseryMenu{ID: id, Date: "2026-10-02", Lunch: "ご飯", Snack: "牛乳", LunchIngredients: "米\n鮭", SnackIngredients: "牛乳", CreatedAt: at, UpdatedAt: at})
	})
	if menu := read(); menu == nil || menu.LunchIngredients != "米\n鮭" || menu.SnackIngredients != "牛乳" {
		t.Fatalf("%+v", menu)
	}
	nmWrite(t, store, func(r application.Repository) error {
		return r.PutNurseryMenu(t.Context(), domain.NurseryMenu{ID: id, Date: "2026-10-02", Lunch: "パン", Snack: "牛乳", CreatedAt: at, UpdatedAt: at})
	})
	if menu := read(); menu == nil || menu.LunchIngredients != "" || menu.SnackIngredients != "" {
		t.Fatalf("replacing must clear ingredients: %+v", menu)
	}
}

func TestNurseryMenuChannelIsReplaced(t *testing.T) {
	_, store := rpSetup(t)
	read := func() *string {
		var channel *string
		if err := store.Read(t.Context(), func(r application.Repository) (err error) {
			channel, err = r.GetNurseryMenuChannel(t.Context())
			return
		}); err != nil {
			t.Fatal(err)
		}
		return channel
	}
	if read() != nil {
		t.Fatal("channel exists before setup")
	}
	for _, id := range []string{"100", "200"} {
		nmWrite(t, store, func(r application.Repository) error {
			return r.PutNurseryMenuChannel(t.Context(), id, time.Now())
		})
	}
	if channel := read(); channel == nil || *channel != "200" {
		t.Fatal(channel)
	}
}

func nmInsertNotice(t *testing.T, db *sql.DB, channel, date, state string, outcomes ...string) {
	t.Helper()
	var id string
	if err := db.QueryRowContext(context.Background(), `INSERT INTO output_tasks(channel_id,kind,target_id,payload,destination_key,state,available_at,created_at,updated_at)
		VALUES($1,'nursery_menu_notice',$2,'{}',$3,$4,now(),now(),now()) RETURNING id`, channel, date, "nursery_menu_notice:"+date, state).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for i, outcome := range outcomes {
		if _, err := db.ExecContext(context.Background(), `INSERT INTO output_dispatches(task_id,attempt,started_at,outcome) VALUES($1,$2,now(),$3)`, id, i+1, outcome); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNurseryMenuNoticeExistsIgnoresChannelAndUndeliveredCancellations(t *testing.T) {
	db, store := rpSetup(t)
	exists := func(date string) bool {
		var found bool
		if err := store.Read(t.Context(), func(r application.Repository) (err error) {
			found, err = r.NurseryMenuNoticeExists(t.Context(), date)
			return
		}); err != nil {
			t.Fatal(err)
		}
		return found
	}
	nmInsertNotice(t, db, "100", "2026-10-01", "succeeded", "succeeded")
	nmInsertNotice(t, db, "100", "2026-10-02", "cancelled")
	nmInsertNotice(t, db, "100", "2026-10-03", "cancelled", "failed")
	nmInsertNotice(t, db, "100", "2026-10-04", "cancelled", "failed", "unknown")
	nmInsertNotice(t, db, "100", "2026-10-05", "uncertain", "unknown")
	nmInsertNotice(t, db, "100", "2026-10-06", "pending")
	for date, want := range map[string]bool{
		"2026-10-01": true, "2026-10-02": false, "2026-10-03": false,
		"2026-10-04": true, "2026-10-05": true, "2026-10-06": true, "2026-10-07": false,
	} {
		if got := exists(date); got != want {
			t.Errorf("%s: got %v", date, got)
		}
	}
}
