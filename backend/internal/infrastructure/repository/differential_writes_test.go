package repository

import (
	"testing"
	"time"
)

func TestPersistenceEqualityKeepsNullAndTimestampPrecision(t *testing.T) {
	empty := ""
	if equalOptional[string](nil, &empty) || !equalOptional[string](nil, nil) {
		t.Fatal("NULL and empty string must remain distinct")
	}
	utc := time.Date(2026, 9, 1, 23, 59, 59, 123000000, time.UTC)
	jst := utc.In(time.FixedZone("JST", 9*60*60))
	if !equalTimestamp(&utc, &jst) {
		t.Fatal("same instant in another zone differs")
	}
	submillisecond := utc.Add(100 * time.Microsecond)
	if !equalTimestamp(&utc, &submillisecond) {
		t.Fatal("same stored millisecond differs")
	}
	nextMillisecond := utc.Add(time.Millisecond)
	if equalTimestamp(&utc, &nextMillisecond) || equalTimestamp(&utc, nil) {
		t.Fatal("different timestamp or NULL compared equal")
	}
	if equalDate(&utc, &jst) {
		t.Fatal("calendar date must not be compared as an instant")
	}
}
