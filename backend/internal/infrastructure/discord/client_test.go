package discord

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

type testClock struct{ now time.Time }

func TestCurrentBotIdentity(t *testing.T) {
	for _, body := range []string{`{"id":"123","bot":true}`, `{"id":"123","bot":false}`, `{"id":"","bot":true}`, `{"id":"invalid","bot":true}`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != "/users/@me" || r.Header.Get("Authorization") != "Bot test-token" {
					t.Error("invalid identity request")
				}
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			id, err := New(server.Client(), server.URL, "test-token", &testClock{time.Now()}).CurrentBotID(t.Context())
			if body == `{"id":"123","bot":true}` {
				if err != nil || id != "123" {
					t.Fatal(id, err)
				}
			} else if err == nil {
				t.Fatal("accepted invalid bot identity")
			}
		})
	}
}

func (c *testClock) Now() time.Time { return c.now }

func TestCreateRecordsNonceAndNeverRetriesUnknownPOST(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "POST" || r.URL.Path != "/channels/100/messages" {
			t.Error(r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bot test-token" {
			t.Error("missing bot authentication")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload["nonce"] != "stable-nonce" || payload["enforce_nonce"] != true || payload["content"] != "@everyone 本文" {
			t.Error(payload)
		}
		w.WriteHeader(502)
		_, _ = w.Write([]byte(`{"message":"secret response must not leak"}`))
	}))
	defer server.Close()
	client := New(server.Client(), server.URL, "test-token", &testClock{time.Now()})
	_, err := client.CreateMessage(t.Context(), "100", application.DisplayMessage{Content: "@everyone 本文"}, "stable-nonce")
	var failure *application.DiscordFailure
	if !errors.As(err, &failure) || failure.Kind != application.DiscordIndeterminate || calls.Load() != 1 {
		t.Fatalf("POST retried or misclassified: %v calls=%d", err, calls.Load())
	}
}

func TestNoticeParentMatchesFrozenTypeScriptPayload(t *testing.T) {
	data, err := os.ReadFile("../../application/testdata/discord_outputs/legacy.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name   string
			Output json.RawMessage
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	var expected map[string]any
	for _, c := range fixture.Cases {
		if c.Name == "reminder-notice-parent" {
			if err := json.Unmarshal(c.Output, &expected); err != nil {
				t.Fatal(err)
			}
		}
	}
	if expected == nil {
		t.Fatal("missing frozen parent payload")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var got map[string]any
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		delete(got, "nonce")
		delete(got, "enforce_nonce")
		if !reflect.DeepEqual(got, expected) {
			t.Errorf("payload mismatch\nwant %#v\ngot %#v", expected, got)
		}
		_, _ = w.Write([]byte(`{"id":"200","channel_id":"100","author":{"id":"bot","bot":true},"nonce":"nonce"}`))
	}))
	defer server.Close()
	client := New(server.Client(), server.URL, "test-token", &testClock{time.Now()})
	message := application.DisplayMessage{Components: []application.DisplayComponent{{Kind: "container", Children: []application.DisplayComponent{
		{Kind: "text", Text: "### 通知用スレッド"},
		{Kind: "row", Children: []application.DisplayComponent{{Kind: "button", CustomID: "remind-task-add", Label: "新規作成", Style: 3}}},
	}}}}
	if _, err := client.CreateMessage(t.Context(), "100", message, "nonce"); err != nil {
		t.Fatal(err)
	}
}

func TestLostCreateResponseIsUncertainWithoutTransparentReplay(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_ = conn.Close()
	}))
	defer server.Close()
	client := New(server.Client(), server.URL, "test-token", &testClock{time.Now()})
	_, err := client.CreateMessage(t.Context(), "100", application.DisplayMessage{Content: "saved at server"}, "nonce")
	var failure *application.DiscordFailure
	if !errors.As(err, &failure) || failure.Kind != application.DiscordIndeterminate || calls.Load() != 1 {
		t.Fatal(err, calls.Load())
	}
}

func TestMessageReadsPreserveAbsentAndNumericNonce(t *testing.T) {
	for _, nonce := range []string{``, `,"nonce":1234567890123456789`, `,"nonce":"opaque"`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"id":"200","channel_id":"100","author":{"id":"bot","bot":true}` + nonce + `}`))
		}))
		client := New(server.Client(), server.URL, "test-token", &testClock{time.Now()})
		message, err := client.GetMessage(t.Context(), "100", "200")
		if err != nil {
			t.Fatal(err)
		}
		want := map[string]string{``: "", `,"nonce":1234567890123456789`: "1234567890123456789", `,"nonce":"opaque"`: "opaque"}[nonce]
		if message.Nonce != want || message.AuthorID != "bot" || !message.AuthorIsBot {
			t.Fatal(message)
		}
		server.Close()
	}
}

func TestRateLimitDefersOnlyItsChannelBucketUnlessGlobal(t *testing.T) {
	for _, global := range []bool{false, true} {
		t.Run(map[bool]string{false: "bucket", true: "global"}[global], func(t *testing.T) {
			var calls atomic.Int32
			clock := &testClock{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					w.Header().Set("X-RateLimit-Bucket", "messages")
					w.WriteHeader(429)
					_ = json.NewEncoder(w).Encode(map[string]any{"retry_after": 2.5, "global": global})
					return
				}
				_, _ = w.Write([]byte(`{"id":"200","channel_id":"101","author":{"id":"bot","bot":true}}`))
			}))
			defer server.Close()
			client := New(server.Client(), server.URL, "test-token", clock)
			_, err := client.CreateMessage(t.Context(), "100", application.DisplayMessage{Content: "text"}, "nonce")
			var failure *application.DiscordFailure
			if !errors.As(err, &failure) || failure.RetryAfter != 2500*time.Millisecond {
				t.Fatal(err)
			}
			_, _ = client.CreateMessage(t.Context(), "100", application.DisplayMessage{Content: "text"}, "nonce")
			if calls.Load() != 1 {
				t.Fatal("bucket delay ignored")
			}
			_, err = client.CreateMessage(t.Context(), "101", application.DisplayMessage{Content: "text"}, "other")
			if global && (err == nil || calls.Load() != 1) || !global && (err != nil || calls.Load() != 2) {
				t.Fatal("wrong rate limit scope", err, calls.Load())
			}
			clock.now = clock.now.Add(3 * time.Second)
			if _, err := client.CreateMessage(t.Context(), "101", application.DisplayMessage{Content: "text"}, "other"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestKnownUnknownMessageIsDifferentFromPermissionAndUnknownChannel(t *testing.T) {
	for _, c := range []struct {
		status, code int
		kind         application.DiscordFailureKind
	}{
		{401, 0, application.DiscordRejected}, {403, 50013, application.DiscordRejected},
		{400, 50035, application.DiscordRejected}, {404, 10008, application.DiscordUnknownMessage},
		{404, 10003, application.DiscordUnknownChannel}, {500, 0, application.DiscordIndeterminate},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(c.status)
			_ = json.NewEncoder(w).Encode(map[string]int{"code": c.code})
		}))
		client := New(server.Client(), server.URL, "test-token", &testClock{time.Now()})
		err := client.DeleteMessage(t.Context(), "100", "200")
		var failure *application.DiscordFailure
		if !errors.As(err, &failure) || failure.Kind != c.kind {
			t.Errorf("%d/%d: %v", c.status, c.code, err)
		}
		server.Close()
	}
}

func TestV2EditClearsLegacyFieldsAndThreadCreationHasNoNonce(t *testing.T) {
	var requests []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		requests = append(requests, payload)
		if r.Method == "POST" {
			_, _ = w.Write([]byte(`{"id":"300","parent_id":"100","owner_id":"bot","thread_metadata":{"archived":false}}`))
		} else {
			w.WriteHeader(204)
		}
	}))
	defer server.Close()
	client := New(server.Client(), server.URL, "test-token", &testClock{time.Now()})
	if err := client.EditMessage(t.Context(), "100", "200", application.DisplayMessage{Components: []application.DisplayComponent{{Kind: "container", Children: []application.DisplayComponent{{Kind: "text", Text: "本文"}}}}}); err != nil {
		t.Fatal(err)
	}
	if requests[0]["flags"] != float64(32768) || requests[0]["content"] != nil || len(requests[0]["embeds"].([]any)) != 0 {
		t.Fatal(requests[0])
	}
	if _, err := client.CreateThread(t.Context(), "100", "200", "通知用スレッド"); err != nil {
		t.Fatal(err)
	}
	if _, ok := requests[1]["nonce"]; ok {
		t.Fatal("thread received nonce")
	}
	if requests[1]["auto_archive_duration"] != float64(1440) {
		t.Fatal(requests[1])
	}
}
