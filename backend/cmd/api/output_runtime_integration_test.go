//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/dbtest"
	"github.com/yone-k/yone-discord-bot/backend/internal/infrastructure/migration"
)

type runtimeDiscordTransport struct{ target *url.URL }

func (r runtimeDiscordTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Host != "discord.com" {
		return nil, errors.New("unexpected outbound host")
	}
	copy := request.Clone(request.Context())
	copy.URL.Scheme, copy.URL.Host = r.target.Scheme, r.target.Host
	copy.Host = r.target.Host
	return http.DefaultTransport.RoundTrip(copy)
}

// The child executes the actual API startup and signal shutdown. Only Discord's
// HTTP transport is replaced; no production endpoint override is introduced.
func TestOutputRuntimeChild(t *testing.T) {
	if os.Getenv("ISSUE44_RUNTIME_CHILD") != "1" {
		return
	}
	target, err := url.Parse(os.Getenv("ISSUE44_RUNTIME_DISCORD"))
	if err != nil {
		t.Fatal(err)
	}
	http.DefaultClient = &http.Client{Transport: runtimeDiscordTransport{target: target}}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, slog.New(slog.NewTextHandler(os.Stderr, nil))); err != nil {
		t.Fatal(err)
	}
}

func TestEnabledOutputRuntimeCommitsAndDrainsOnSignal(t *testing.T) {
	for _, scenario := range []string{"enabled", "disabled", "invalid identity", "shutdown during POST"} {
		t.Run(scenario, func(t *testing.T) {
			db := dbtest.Open(t)
			dbtest.Reset(t, db)
			directory := "../../../db/migrations"
			if err := (migration.Runner{Directory: directory}).Apply(t.Context(), db, ""); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(t.Context(), "INSERT INTO data_imports(snapshot_sha256,schema_version,completed_at,report) VALUES(repeat('a',64),1,now(),'{}')"); err != nil {
				t.Fatal(err)
			}
			port, err := net.Listen("tcp", ":8080")
			if err != nil {
				t.Fatal("integration test requires port 8080", err)
			}
			_ = port.Close()
			var requests, posts atomic.Int32
			started, release := make(chan struct{}, 1), make(chan struct{})
			fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				requests.Add(1)
				w.Header().Set("Content-Type", "application/json")
				if request.URL.Path == "/api/v10/users/@me" {
					if scenario == "invalid identity" {
						w.WriteHeader(401)
						_, _ = io.WriteString(w, "{}")
						return
					}
					_, _ = io.WriteString(w, "{\"id\":\"999\",\"bot\":true}")
					return
				}
				if request.Method == "POST" && request.URL.Path == "/api/v10/channels/100/messages" {
					posts.Add(1)
					var payload struct{ Nonce string }
					if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
						t.Error(err)
						w.WriteHeader(400)
						return
					}
					var count int
					if err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM output_dispatches WHERE nonce=$1 AND outcome='unknown'", payload.Nonce).Scan(&count); err != nil || count != 1 {
						t.Error("POST preceded durable dispatch", count, err)
					}
					if scenario == "shutdown during POST" {
						started <- struct{}{}
						select {
						case <-release:
						case <-request.Context().Done():
							return
						}
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "300", "channel_id": "100", "author": map[string]any{"id": "999", "bot": true}, "nonce": payload.Nonce})
					return
				}
				if request.Method == "GET" && request.URL.Path == "/api/v10/channels/100/messages/300" {
					_, _ = io.WriteString(w, "{\"id\":\"300\",\"channel_id\":\"100\",\"author\":{\"id\":\"999\",\"bot\":true}}")
					return
				}
				if (request.Method == "PATCH" && request.URL.Path == "/api/v10/channels/100/messages/300") || (request.Method == "PUT" && request.URL.Path == "/api/v10/channels/100/pins/300") {
					_, _ = io.WriteString(w, "{}")
					return
				}
				t.Errorf("unexpected Discord request %s %s", request.Method, request.URL.Path)
				w.WriteHeader(400)
			}))
			defer fake.Close()
			enabled := "true"
			if scenario == "disabled" {
				enabled = "false"
			}
			command := exec.Command(os.Args[0], "-test.run=^TestOutputRuntimeChild$", "-test.timeout=45s")
			command.Env = append(os.Environ(), "ISSUE44_RUNTIME_CHILD=1", "ISSUE44_RUNTIME_DISCORD="+fake.URL, "DATABASE_URL="+os.Getenv("TEST_DATABASE_URL"), "MIGRATIONS_DIR="+directory, "CORE_API_TOKEN=runtime-test-token", "DISCORD_BOT_TOKEN=runtime-test-bot", "DISCORD_OUTPUT_ENABLED="+enabled)
			var logs bytes.Buffer
			command.Stdout, command.Stderr = &logs, &logs
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- command.Wait() }()
			stopped := false
			defer func() {
				if !stopped {
					_ = command.Process.Kill()
					<-done
				}
			}()
			client := &http.Client{Timeout: time.Second}
			status := func() (map[string]any, error) {
				request, _ := http.NewRequestWithContext(t.Context(), "GET", "http://127.0.0.1:8080/v1/outputs/status", nil)
				request.Header.Set("Authorization", "Bearer runtime-test-token")
				response, err := client.Do(request)
				if err != nil {
					return nil, err
				}
				defer response.Body.Close()
				var result map[string]any
				err = json.NewDecoder(response.Body).Decode(&result)
				if response.StatusCode != 200 {
					return nil, errors.New("status not ready")
				}
				return result, err
			}
			waitFor := func(check func() bool) {
				t.Helper()
				deadline := time.Now().Add(15 * time.Second)
				for time.Now().Before(deadline) {
					if check() {
						return
					}
					select {
					case err := <-done:
						stopped = true
						t.Fatalf("API exited: %v\n%s", err, logs.String())
					default:
					}
					time.Sleep(25 * time.Millisecond)
				}
				t.Fatal("runtime condition did not complete")
			}
			wantRunning := scenario == "enabled" || scenario == "shutdown during POST"
			waitFor(func() bool {
				state, err := status()
				if scenario == "invalid identity" && requests.Load() == 0 {
					return false
				}
				return err == nil && state["enabled"] == (enabled == "true") && state["workerRunning"] == wantRunning && state["contract"] == "go-discord-output-v1"
			})
			request, _ := http.NewRequestWithContext(t.Context(), "PUT", "http://127.0.0.1:8080/v1/lists/100", strings.NewReader("{\"channelId\":\"100\",\"listTitle\":\"runtime\",\"defaultCategory\":\"other\"}"))
			request.Header.Set("Authorization", "Bearer runtime-test-token")
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Actor-Id", "999")
			request.Header.Set("X-Operation-Kind", "InitListCommand")
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(response.Body)
			_ = response.Body.Close()
			if response.StatusCode != 200 {
				t.Fatalf("business write: %d %s", response.StatusCode, body)
			}
			if wantRunning {
				if scenario == "shutdown during POST" {
					select {
					case <-started:
					case <-time.After(10 * time.Second):
						t.Fatal("POST did not begin")
					}
					if err := command.Process.Signal(syscall.SIGTERM); err != nil {
						t.Fatal(err)
					}
					close(release)
				} else {
					waitFor(func() bool {
						var count int
						err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM output_tasks WHERE state='succeeded'").Scan(&count)
						return err == nil && count > 0
					})
				}
			} else {
				var count int
				if err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM output_tasks WHERE state='pending'").Scan(&count); err != nil || count != 1 {
					t.Fatal("disabled worker lost reservation", count, err)
				}
				if posts.Load() != 0 || scenario == "disabled" && requests.Load() != 0 {
					t.Fatal("disabled/unverified worker sent output")
				}
			}
			if scenario != "shutdown during POST" {
				_ = command.Process.Signal(syscall.SIGTERM)
			}
			select {
			case err := <-done:
				stopped = true
				if err != nil {
					t.Fatalf("API shutdown: %v\n%s", err, logs.String())
				}
			case <-time.After(15 * time.Second):
				t.Fatal("API failed to drain")
			}
			if wantRunning {
				var messageID string
				if err := db.QueryRowContext(t.Context(), "SELECT message_id FROM list_channels WHERE channel_id='100'").Scan(&messageID); err != nil || messageID != "300" || posts.Load() != 1 {
					t.Fatal("confirmed creation lost or duplicated", messageID, posts.Load(), err)
				}
				var succeeded int
				if err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM output_dispatches WHERE outcome='succeeded' AND discord_message_id='300'").Scan(&succeeded); err != nil || succeeded != 1 {
					t.Fatal(succeeded, err)
				}
			}
			connection, err := db.Conn(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			var acquired bool
			if err := connection.QueryRowContext(t.Context(), "SELECT pg_try_advisory_lock(44001)").Scan(&acquired); err != nil || !acquired {
				t.Fatal("API retained output leadership after exit", acquired, err)
			}
			if _, err := connection.ExecContext(t.Context(), "SELECT pg_advisory_unlock(44001)"); err != nil {
				t.Fatal(err)
			}
		})
	}
}
