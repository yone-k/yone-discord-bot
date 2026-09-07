package application

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestOperationLogMatchesAllLegacyOutcomes(t *testing.T) {
	data, err := os.ReadFile("testdata/discord_outputs/legacy.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Now   time.Time
		Cases []struct {
			Name   string
			Input  json.RawMessage
			Output json.RawMessage
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, c := range fixture.Cases {
		if !strings.HasPrefix(c.Name, "log-") {
			continue
		}
		t.Run(c.Name, func(t *testing.T) {
			var in struct {
				ActorID string
				Result  struct {
					Success bool
					Message string
				}
				Details struct {
					CancelReason string
					Changes      struct {
						Added, Removed []LogItem
						Modified       []struct {
							Name          string
							Before, After json.RawMessage
						}
						Before, After json.RawMessage
					}
				}
			}
			if err := json.Unmarshal(c.Input, &in); err != nil {
				t.Fatal(err)
			}
			name := strings.Split(strings.TrimPrefix(c.Name, "log-"), "-")[0] + "Handler"
			facts := OperationFacts{Message: in.Result.Message, CancelReason: in.Details.CancelReason, Added: in.Details.Changes.Added, Removed: in.Details.Changes.Removed, LegacyBefore: string(in.Details.Changes.Before), LegacyAfter: string(in.Details.Changes.After)}
			for _, m := range in.Details.Changes.Modified {
				change := LogItemChange{Name: m.Name}
				if err := json.Unmarshal(m.Before, &change.Before); err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal(m.After, &change.After); err != nil {
					t.Fatal(err)
				}
				var before, after map[string]json.RawMessage
				if err := json.Unmarshal(m.Before, &before); err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal(m.After, &after); err != nil {
					t.Fatal(err)
				}
				change.CheckPresent = before["check"] != nil && after["check"] != nil
				change.CategoryPresent = before["category"] != nil && after["category"] != nil
				change.UntilPresent = before["until"] != nil && after["until"] != nil
				facts.Modified = append(facts.Modified, change)
			}
			got, err := FormatOperationLog(OperationRecord{ActorID: in.ActorID, Kind: OperationKind(name), Success: in.Result.Success, OccurredAt: fixture.Now, Facts: facts})
			if err != nil {
				t.Fatal(err)
			}
			var want string
			if err := json.Unmarshal(c.Output, &want); err != nil {
				t.Fatal(err)
			}
			if got != want {
				t.Errorf("want:\n%s\ngot:\n%s", want, got)
			}
		})
		count++
	}
	if count != 45 {
		t.Fatalf("expected all 45 operation outcomes, got %d", count)
	}
}
