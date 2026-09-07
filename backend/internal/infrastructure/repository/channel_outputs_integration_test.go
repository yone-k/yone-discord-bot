//go:build integration

package repository_test

import (
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestReminderSettingsReserveCardsAndSingleOperation(t *testing.T) {
	for _, action := range []string{"save", "patch", "link"} {
		t.Run(action, func(t *testing.T) {
			db, store := rpSetup(t)
			_, ch, task := rpSeedCatalogTask(t, store)
			second := *task
			second.ID = rpID()
			second.EntityID = second.ID
			second.MessageID = nil
			second.InventoryItems = nil
			second.Position = 1
			rpWrite(t, store, func(r application.Repository) error {
				return r.PutTask(t.Context(), &second, ch.LinkedInventoryChannelID, true)
			})
			kind := application.OperationKind("InitRemindListCommand")
			if action == "link" {
				kind = "LinkInventoryCommand"
			}
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: kind})
			if err != nil {
				t.Fatal(err)
			}
			s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
			switch action {
			case "save":
				ch.ListTitle = "changed"
				_, err = s.SaveRemindChannel(ctx, *ch)
			case "patch":
				_, err = s.PatchRemindChannel(ctx, ch.ChannelID, application.ChannelPatch{ListTitle: application.Some("changed")})
			case "link":
				_, err = s.LinkInventory(ctx, ch.ChannelID, ch.LinkedInventoryChannelID)
			}
			if err != nil {
				t.Fatal(err)
			}
			rpRead(t, store, func(r application.Repository) error {
				jobs, err := r.ListOutputs(ctx, application.OutputFilter{})
				if err != nil {
					return err
				}
				if len(jobs) != 2 {
					t.Fatalf("want both task cards, got %d outputs", len(jobs))
				}
				for _, job := range jobs {
					if job.Kind != application.OutputTaskCard || job.ChannelID != ch.ChannelID || job.OperationID == "" || job.OperationID != jobs[0].OperationID {
						t.Fatal("incorrect reservation", job)
					}
				}
				return nil
			})
			var count int
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != 1 {
				t.Fatal("operation count", count, err)
			}
		})
	}
}

func TestUnlinkInventoryAndCardsCommitTogether(t *testing.T) {
	for _, reject := range []bool{false, true} {
		name := "success"
		if reject {
			name = "reservation failure"
		}
		t.Run(name, func(t *testing.T) {
			db, store := rpSetup(t)
			_, ch, task := rpSeedCatalogTask(t, store)
			task.InventoryItems = nil
			rpWrite(t, store, func(r application.Repository) error {
				return r.PutTask(t.Context(), task, ch.LinkedInventoryChannelID, true)
			})
			ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: "UnlinkInventoryCommand"})
			if err != nil {
				t.Fatal(err)
			}
			if reject {
				if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER reject_reservation BEFORE INSERT ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_reservation()`); err != nil {
					t.Fatal(err)
				}
			}
			s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
			_, err = s.LinkInventory(ctx, ch.ChannelID, nil)
			if (err != nil) != reject {
				t.Fatalf("reject=%v error=%v", reject, err)
			}
			rpRead(t, store, func(r application.Repository) error {
				stored, err := r.GetRemindChannel(ctx, ch.ChannelID, false)
				if err != nil {
					return err
				}
				if (stored.LinkedInventoryChannelID != nil) != reject {
					t.Fatal("link transaction mismatch", stored.LinkedInventoryChannelID)
				}
				jobs, err := r.ListOutputs(ctx, application.OutputFilter{})
				if err != nil {
					return err
				}
				want := 1
				if reject {
					want = 0
				}
				if len(jobs) != want {
					t.Fatalf("want %d outputs got %d", want, len(jobs))
				}
				return nil
			})
			var count int
			want := 1
			if reject {
				want = 0
			}
			if err := db.QueryRowContext(ctx, "SELECT count(*) FROM operation_records").Scan(&count); err != nil || count != want {
				t.Fatal("operation rollback mismatch", count, err)
			}
		})
	}
}

func TestChannelSettingsReserveRenderingAtomically(t *testing.T) {
	for _, kind := range []application.OutputKind{application.OutputListRender, application.OutputInventoryRender} {
		for _, patch := range []bool{false, true} {
			for _, reject := range []bool{false, true} {
				name := string(kind)
				if patch {
					name += "/patch"
				} else {
					name += "/save"
				}
				if reject {
					name += "/rollback"
				}
				t.Run(name, func(t *testing.T) {
					db, store := rpSetup(t)
					ctx, err := application.WithOutputOperation(t.Context(), application.OutputOperation{ActorID: "123", Kind: "InitListCommand"})
					if err != nil {
						t.Fatal(err)
					}
					settings := domain.ChannelSettings{ChannelID: "100", ListTitle: "before"}
					rpWrite(t, store, func(r application.Repository) error {
						if kind == application.OutputListRender {
							return r.PutList(ctx, &domain.List{Channel: domain.ListChannel{ChannelSettings: settings, DefaultCategory: "その他"}})
						}
						return r.PutCatalog(ctx, &domain.InventoryCatalog{Channel: domain.InventoryChannel{ChannelSettings: settings, DefaultCategory: "その他"}})
					})
					if reject {
						if _, err := db.ExecContext(ctx, `CREATE FUNCTION reject_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER reject_reservation BEFORE INSERT ON output_tasks FOR EACH ROW EXECUTE FUNCTION reject_reservation()`); err != nil {
							t.Fatal(err)
						}
					}
					s := application.New(store, fixedClock{time.Now().UTC()}, ids{})
					settings.ListTitle = "after"
					p := application.ChannelPatch{ListTitle: application.Some("after")}
					if kind == application.OutputListRender {
						if patch {
							_, err = s.PatchListChannel(ctx, "100", p)
						} else {
							_, err = s.SaveListChannel(ctx, domain.ListChannel{ChannelSettings: settings, DefaultCategory: "その他"})
						}
					} else {
						if patch {
							_, err = s.PatchInventoryChannel(ctx, "100", p)
						} else {
							_, err = s.SaveInventoryChannel(ctx, domain.InventoryChannel{ChannelSettings: settings, DefaultCategory: "その他"})
						}
					}
					if (err != nil) != reject {
						t.Fatalf("reject=%v error=%v", reject, err)
					}
					rpRead(t, store, func(r application.Repository) error {
						jobs, err := r.ListOutputs(ctx, application.OutputFilter{ChannelID: "100"})
						if err != nil {
							return err
						}
						want := 1
						if reject {
							want = 0
						}
						if len(jobs) != want {
							t.Fatalf("want %d reservations, got %d", want, len(jobs))
						}
						if !reject && (jobs[0].Kind != kind || jobs[0].OperationID == "") {
							t.Fatal("missing card operation", jobs[0])
						}
						var title string
						if kind == application.OutputListRender {
							list, err := r.GetList(ctx, "100", false)
							if err != nil {
								return err
							}
							title = list.Channel.ListTitle
						} else {
							catalog, err := r.GetCatalog(ctx, "100", false)
							if err != nil {
								return err
							}
							title = catalog.Channel.ListTitle
						}
						wantTitle := "after"
						if reject {
							wantTitle = "before"
						}
						if title != wantTitle {
							t.Fatalf("want title %s got %s", wantTitle, title)
						}
						return nil
					})
				})
			}
		}
	}
}
