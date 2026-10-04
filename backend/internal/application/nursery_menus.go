package application

import (
	"context"
	"sort"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

const nurseryMenuMaxDays = 62

type NurseryMenuEntry struct {
	Date, Lunch, Snack                 string
	LunchIngredients, SnackIngredients string
}

func validateNurseryDate(date, target string) error {
	if domain.ValidateDate(date) != nil {
		return domain.Fail(domain.CodeInvalidInput, target, "Invalid calendar date")
	}
	return nil
}

func getNurseryMenu(ctx context.Context, r Repository, date string) (*domain.NurseryMenu, error) {
	if e := validateNurseryDate(date, "date"); e != nil {
		return nil, e
	}
	menu, e := r.GetNurseryMenu(ctx, date)
	return required(menu, e, date)
}

func (s *Service) GetNurseryMenu(ctx context.Context, date string) (*domain.NurseryMenu, error) {
	return read(s, ctx, func(r Repository) (*domain.NurseryMenu, error) { return getNurseryMenu(ctx, r, date) })
}

func (s *Service) ListNurseryMenus(ctx context.Context, from, to string) ([]domain.NurseryMenu, error) {
	if e := validateNurseryDate(from, "from"); e != nil {
		return nil, e
	}
	if e := validateNurseryDate(to, "to"); e != nil {
		return nil, e
	}
	start, _ := time.Parse(time.DateOnly, from)
	end, _ := time.Parse(time.DateOnly, to)
	if end.Before(start) || end.Sub(start) >= nurseryMenuMaxDays*24*time.Hour {
		return nil, domain.Fail(domain.CodeInvalidInput, "to", "Range must be 1 to 62 days")
	}
	return read(s, ctx, func(r Repository) ([]domain.NurseryMenu, error) { return r.NurseryMenus(ctx, from, to) })
}

func (s *Service) PutNurseryMenu(ctx context.Context, entry NurseryMenuEntry) (*domain.NurseryMenu, error) {
	menus, e := s.PutNurseryMenus(ctx, []NurseryMenuEntry{entry})
	if e != nil {
		return nil, e
	}
	return &menus[0], nil
}

// PutNurseryMenus validates every entry before the first write, so an invalid
// batch changes nothing. Dates not listed are left untouched.
func (s *Service) PutNurseryMenus(ctx context.Context, entries []NurseryMenuEntry) ([]domain.NurseryMenu, error) {
	if len(entries) == 0 || len(entries) > nurseryMenuMaxDays {
		return nil, domain.Fail(domain.CodeInvalidInput, "items", "A batch must contain 1 to 62 menus")
	}
	menus := make([]domain.NurseryMenu, 0, len(entries))
	seen := map[string]bool{}
	for _, entry := range entries {
		menu, e := domain.NewNurseryMenu(domain.NurseryMenu{Date: entry.Date, Lunch: entry.Lunch, Snack: entry.Snack, LunchIngredients: entry.LunchIngredients, SnackIngredients: entry.SnackIngredients})
		if e != nil {
			return nil, e
		}
		if seen[menu.Date] {
			return nil, domain.Fail(domain.CodeInvalidInput, menu.Date, "Duplicate date")
		}
		seen[menu.Date] = true
		menus = append(menus, menu)
	}
	sort.Slice(menus, func(i, j int) bool { return menus[i].Date < menus[j].Date })
	return write(s, ctx, func(r Repository) ([]domain.NurseryMenu, error) {
		now := s.now()
		for i := range menus {
			previous, e := r.GetNurseryMenu(ctx, menus[i].Date)
			if e != nil {
				return nil, e
			}
			menus[i].CreatedAt, menus[i].UpdatedAt = now, now
			if previous != nil {
				menus[i].ID, menus[i].CreatedAt = previous.ID, previous.CreatedAt
			} else if menus[i].ID, e = s.ids.NewID(); e != nil {
				return nil, e
			}
			if e = r.PutNurseryMenu(ctx, menus[i]); e != nil {
				return nil, e
			}
		}
		return menus, nil
	})
}

func (s *Service) DeleteNurseryMenu(ctx context.Context, date string) error {
	return s.store.Write(ctx, func(r Repository) error {
		if _, e := getNurseryMenu(ctx, r, date); e != nil {
			return e
		}
		return r.DeleteNurseryMenu(ctx, date)
	})
}

func (s *Service) GetNurseryMenuChannel(ctx context.Context) (string, error) {
	return read(s, ctx, func(r Repository) (string, error) {
		channel, e := r.GetNurseryMenuChannel(ctx)
		if channel, e = required(channel, e, "nurseryMenuChannel"); e != nil {
			return "", e
		}
		return *channel, nil
	})
}

func (s *Service) SetNurseryMenuChannel(ctx context.Context, channelID string) (string, error) {
	if !discordID.MatchString(channelID) {
		return "", domain.Fail(domain.CodeInvalidInput, "channelId", "Invalid Discord ID")
	}
	return write(s, ctx, func(r Repository) (string, error) {
		return channelID, r.PutNurseryMenuChannel(ctx, channelID, s.now())
	})
}
