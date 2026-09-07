//go:build integration

package repository_test

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestExplicitInitializationOnlyResumesAfterDeletionTerminates(t *testing.T) {
	for _, state := range []application.OutputState{application.OutputPending, application.OutputRunning, application.OutputRetryWait, application.OutputUncertain, application.OutputBlocked, application.OutputSucceeded, application.OutputCancelled} {
		t.Run(string(state), func(t *testing.T) {
			_, store := rpSetup(t)
			ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
			job := queuedOutput("100", application.OutputDeleteAll, now)
			job.State = state
			rpWrite(t, store, func(r application.Repository) error {
				settings := domain.ChannelSettings{ChannelID: "100", ListTitle: "title"}
				if err := r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: settings, DefaultCategory: "その他"}}); err != nil {
					return err
				}
				if err := r.PutCatalog(ctx, &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: settings, DefaultCategory: "その他"}}); err != nil {
					return err
				}
				if _, err := r.PutCardView(ctx, application.CardView{ChannelID: "100", TargetKind: application.CardInventory, TargetID: "100", Mode: application.CardDeleteSelection}); err != nil {
					return err
				}
				if err := r.PutSuspension(ctx, application.OutputSuspension{ChannelID: "100", SuspendedBy: "123", SuspendedAt: now}); err != nil {
					return err
				}
				_, err := r.EnqueueOutput(ctx, job)
				return err
			})
			s := application.New(store, fixedClock{now}, ids{})
			_, err := s.InitializeOutputs(ctx, "100", "list", nil)
			allowed := state == application.OutputSucceeded || state == application.OutputCancelled
			if (err == nil) != allowed {
				t.Fatal("incorrect initialization result", err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stop, err := r.GetSuspension(ctx, "100")
				if err != nil {
					return err
				}
				if (stop == nil) != allowed {
					t.Fatal("incorrect suspension state", stop)
				}
				view, err := r.GetCardView(ctx, "100", application.CardInventory, "100")
				if err != nil {
					return err
				}
				wantMode := application.CardDeleteSelection
				if allowed {
					wantMode = application.CardNormal
				}
				if view.Mode != wantMode {
					t.Fatal("incorrect view state", view)
				}
				jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: "100"})
				if err != nil {
					return err
				}
				want := 1
				if allowed {
					want = 3
				}
				if len(jobs) != want {
					t.Fatalf("want %d jobs got %d", want, len(jobs))
				}
				return nil
			})
		})
	}
}

func TestInitializationLogSettingThreeValues(t *testing.T) {
	for _, existing := range []bool{false, true} {
		for _, setting := range []string{"omitted", "enabled", "disabled"} {
			name := setting
			if existing {
				name += "/existing"
			}
			t.Run(name, func(t *testing.T) {
				_, store := rpSetup(t)
				ctx := t.Context()
				list := &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list"}, DefaultCategory: "その他"}}
				if existing {
					list.Channel.OperationLogThreadID = rpPtr("200")
				}
				rpWrite(t, store, func(r application.Repository) error { return r.PutList(ctx, list) })
				var enable *bool
				if setting != "omitted" {
					enable = rpPtr(setting == "enabled")
				}
				s := application.New(store, fixedClock{time.Now().UTC().Truncate(time.Millisecond)}, ids{})
				if _, err := s.InitializeOutputs(ctx, "100", "list", enable); err != nil {
					t.Fatal(err)
				}
				rpRead(t, store, func(r application.Repository) error {
					stored, err := r.GetList(ctx, "100", false)
					if err != nil {
						return err
					}
					if (stored.Channel.OperationLogThreadID != nil) != (existing && setting != "disabled") {
						t.Fatal("setting changed incorrectly", stored.Channel)
					}
					jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: "100"})
					if err != nil {
						return err
					}
					threads := 0
					for _, job := range jobs {
						if job.Kind == application.OutputThreadEnsure {
							threads++
							if job.Payload.AllowCreate != (setting == "enabled") {
								t.Fatal("wrong creation permission", job)
							}
						}
					}
					want := 0
					if setting == "enabled" || existing && setting == "omitted" {
						want = 1
					}
					if threads != want {
						t.Fatal("wrong thread count", threads)
					}
					return nil
				})
			})
		}
	}
}

func TestDisablingLogDuringCreatePreservesUnknownAndRejectsLateResult(t *testing.T) {
	_, store := rpSetup(t)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	s := application.New(store, fixedClock{now}, ids{})
	rpWrite(t, store, func(r application.Repository) error {
		return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: domain.ChannelSettings{ChannelID: "100", ListTitle: "list"}, DefaultCategory: "その他"}})
	})
	if _, err := s.InitializeOutputs(ctx, "100", "list", rpPtr(true)); err != nil {
		t.Fatal(err)
	}
	job, err := s.ClaimOutput(ctx, "leader")
	if err != nil || job == nil || job.Kind != application.OutputThreadEnsure {
		t.Fatal(job, err)
	}
	dispatch, err := s.BeginOutputDispatch(ctx, job.ID, "leader", "thread", "100", true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.InitializeOutputs(ctx, "100", "list", rpPtr(false)); err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteOutputDispatch(ctx, job.ID, "leader", "thread", dispatch.ID, "200", true); err == nil {
		t.Fatal("late creation enabled logging again")
	}
	if _, err := s.InitializeOutputs(ctx, "100", "list", rpPtr(true)); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		list, err := r.GetList(ctx, "100", false)
		if err != nil {
			return err
		}
		if list.Channel.OperationLogThreadID != nil {
			t.Fatal("late ID persisted")
		}
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: "100"})
		if err != nil {
			return err
		}
		threads := 0
		for _, stored := range jobs {
			if stored.Kind == application.OutputThreadEnsure {
				threads++
				if stored.ID != job.ID || stored.State != application.OutputUncertain {
					t.Fatal("unknown creation bypassed", stored)
				}
			}
		}
		if threads != 1 {
			t.Fatal("duplicate creation intent", threads)
		}
		history, err := r.OutputDispatches(ctx, job.ID)
		if err != nil {
			return err
		}
		if len(history) != 1 || history[0].Outcome != application.DispatchUnknown {
			t.Fatal("dispatch evidence lost", history)
		}
		return nil
	})
}

func TestRedrawPreservesSuspensionAndSelection(t *testing.T) {
	_, store := rpSetup(t)
	catalog, _, _ := rpSeedCatalogTask(t, store)
	ctx, now := t.Context(), time.Now().UTC().Truncate(time.Millisecond)
	channel := catalog.Channel.ChannelID
	rpWrite(t, store, func(r application.Repository) error {
		if _, err := r.PutCardView(ctx, application.CardView{ChannelID: channel, TargetKind: application.CardInventory, TargetID: channel, Mode: application.CardDeleteSelection}); err != nil {
			return err
		}
		return r.PutSuspension(ctx, application.OutputSuspension{ChannelID: channel, SuspendedAt: now, SuspendedBy: "123"})
	})
	s := application.New(store, fixedClock{now}, ids{})
	if _, err := s.RedrawOutputs(ctx, channel, "inventory"); err != nil {
		t.Fatal(err)
	}
	rpRead(t, store, func(r application.Repository) error {
		view, err := r.GetCardView(ctx, channel, application.CardInventory, channel)
		if err != nil {
			return err
		}
		if view.Mode != application.CardDeleteSelection || view.Version != 1 {
			t.Fatal("redraw reset view", view)
		}
		stop, err := r.GetSuspension(ctx, channel)
		if err != nil {
			return err
		}
		if stop == nil {
			t.Fatal("redraw resumed output")
		}
		jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: channel})
		if err != nil {
			return err
		}
		if len(jobs) != 1 || jobs[0].Kind != application.OutputInventoryRender {
			t.Fatal("redraw not reserved", jobs)
		}
		return nil
	})
	if job, err := s.ClaimOutput(ctx, "leader"); err != nil || job != nil {
		t.Fatal("suspended redraw claimed", job, err)
	}
}
