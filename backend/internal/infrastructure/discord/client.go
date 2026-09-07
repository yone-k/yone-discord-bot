// Package discord implements the application's output port using Discord REST
// v10. It never retries a request: each create attempt belongs to a DB dispatch.
package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

const APIBaseURL = "https://discord.com/api/v10"

type Client struct {
	http        *http.Client
	base, token string
	clock       application.Clock
	mu          sync.Mutex
	buckets     map[string]string
	until       map[string]time.Time
	globalUntil time.Time
}

var _ application.DiscordGateway = (*Client)(nil)

func New(client *http.Client, base, token string, clock application.Clock) *Client {
	copyClient := *client
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if copyClient.Timeout == 0 {
		copyClient.Timeout = 8 * time.Second
	}
	return &Client{http: &copyClient, base: strings.TrimRight(base, "/"), token: token, clock: clock, buckets: map[string]string{}, until: map[string]time.Time{}}
}

func rejected() error { return &application.DiscordFailure{Kind: application.DiscordRejected} }

// CurrentBotID derives message ownership from the authenticated bot token.
func (c *Client) CurrentBotID(ctx context.Context) (string, error) {
	var user struct {
		ID  string `json:"id"`
		Bot bool   `json:"bot"`
	}
	if err := c.request(ctx, http.MethodGet, "/users/@me", "GET /users/@me", "", nil, &user); err != nil {
		return "", err
	}
	id, err := strconv.ParseUint(user.ID, 10, 64)
	if err != nil || id == 0 || !user.Bot {
		return "", rejected()
	}
	return user.ID, nil
}
func indeterminate() error {
	return &application.DiscordFailure{Kind: application.DiscordIndeterminate}
}

func (c *Client) request(ctx context.Context, method, path, route, major string, body any, out any) error {
	key := method + " " + route + ":" + major
	c.mu.Lock()
	bucket := c.buckets[key]
	if bucket == "" {
		bucket = key
	}
	due := c.until[bucket]
	if c.globalUntil.After(due) {
		due = c.globalUntil
	}
	wait := due.Sub(c.clock.Now())
	c.mu.Unlock()
	if wait > 0 {
		return &application.DiscordFailure{Kind: application.DiscordRateLimited, RetryAfter: wait}
	}
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return rejected()
		}
		// NopCloser deliberately prevents net/http from installing GetBody and
		// replaying a POST after a connection failure or redirect.
		reader = io.NopCloser(bytes.NewReader(data))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return rejected()
	}
	req.Header.Set("Authorization", "Bot "+c.token)
	req.Header.Set("User-Agent", "DiscordBot (https://github.com/yone-k/yone-discord-bot, 1.0)")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return indeterminate()
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	var responseError struct {
		Code       int     `json:"code"`
		RetryAfter float64 `json:"retry_after"`
		Global     bool    `json:"global"`
	}
	if resp.StatusCode >= 300 {
		_ = json.Unmarshal(data, &responseError)
	}
	c.mu.Lock()
	if id := resp.Header.Get("X-RateLimit-Bucket"); id != "" {
		bucket = id + ":" + major
		c.buckets[key] = bucket
	}
	now := c.clock.Now()
	if resp.Header.Get("X-RateLimit-Remaining") == "0" {
		seconds, _ := strconv.ParseFloat(resp.Header.Get("X-RateLimit-Reset-After"), 64)
		if seconds > 0 && !math.IsInf(seconds, 0) && !math.IsNaN(seconds) {
			reset := now.Add(time.Duration(seconds * float64(time.Second)))
			if reset.After(c.until[bucket]) {
				c.until[bucket] = reset
			}
		}
	}
	var retry time.Duration
	if resp.StatusCode == 429 {
		seconds := responseError.RetryAfter
		if seconds <= 0 {
			seconds, _ = strconv.ParseFloat(resp.Header.Get("Retry-After"), 64)
		}
		if seconds <= 0 || math.IsInf(seconds, 0) || math.IsNaN(seconds) {
			seconds = 1
		}
		retry = time.Duration(seconds * float64(time.Second))
		reset := now.Add(retry)
		if responseError.Global || resp.Header.Get("X-RateLimit-Global") == "true" {
			if reset.After(c.globalUntil) {
				c.globalUntil = reset
			}
		} else if reset.After(c.until[bucket]) {
			c.until[bucket] = reset
		}
	}
	c.mu.Unlock()
	if resp.StatusCode == 429 {
		return &application.DiscordFailure{Kind: application.DiscordRateLimited, RetryAfter: retry, Code: responseError.Code}
	}
	if readErr != nil || resp.StatusCode >= 500 {
		return indeterminate()
	}
	if resp.StatusCode >= 300 {
		kind := application.DiscordRejected
		if resp.StatusCode == 404 && responseError.Code == 10008 {
			kind = application.DiscordUnknownMessage
		}
		if resp.StatusCode == 404 && responseError.Code == 10003 {
			kind = application.DiscordUnknownChannel
		}
		return &application.DiscordFailure{Kind: kind, Code: responseError.Code, HTTPStatus: resp.StatusCode}
	}
	if out != nil && json.Unmarshal(data, out) != nil {
		return indeterminate()
	}
	return nil
}

type component struct {
	Type        int         `json:"type"`
	Content     string      `json:"content,omitempty"`
	CustomID    string      `json:"custom_id,omitempty"`
	Label       string      `json:"label,omitempty"`
	Style       int         `json:"style,omitempty"`
	Placeholder string      `json:"placeholder,omitempty"`
	MinValues   int         `json:"min_values,omitempty"`
	MaxValues   int         `json:"max_values,omitempty"`
	Options     []option    `json:"options,omitempty"`
	Components  []component `json:"components,omitempty"`
	Emoji       *emoji      `json:"emoji,omitempty"`
}
type emoji struct {
	Name     string `json:"name"`
	Animated bool   `json:"animated"`
}
type option struct {
	Label       string `json:"label"`
	Value       string `json:"value"`
	Description string `json:"description,omitempty"`
}

func components(values []application.DisplayComponent) ([]component, error) {
	result := make([]component, 0, len(values))
	for _, v := range values {
		kind := map[string]int{"container": 17, "text": 10, "row": 1, "button": 2, "select": 3}[v.Kind]
		if kind == 0 {
			return nil, rejected()
		}
		children, err := components(v.Children)
		if err != nil {
			return nil, err
		}
		value := component{Type: kind, Content: v.Text, CustomID: v.CustomID, Label: v.Label, Style: v.Style, Placeholder: v.Placeholder, MinValues: v.MinValues, MaxValues: v.MaxValues, Components: children}
		if v.Emoji != "" {
			value.Emoji = &emoji{Name: v.Emoji}
		}
		for _, o := range v.Options {
			value.Options = append(value.Options, option{Label: o.Label, Value: o.Value, Description: o.Description})
		}
		result = append(result, value)
	}
	return result, nil
}

func messagePayload(message application.DisplayMessage, edit bool) (map[string]any, error) {
	if len(message.Components) == 0 {
		return map[string]any{"content": message.Content}, nil
	}
	values, err := components(message.Components)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{"flags": 32768, "components": values}
	if edit {
		payload["content"] = nil
		payload["embeds"] = []any{}
	}
	return payload, nil
}

type restMessage struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	Author    struct {
		ID  string `json:"id"`
		Bot bool   `json:"bot"`
	} `json:"author"`
	Nonce     json.RawMessage `json:"nonce"`
	Timestamp time.Time       `json:"timestamp"`
}

func (m restMessage) message() application.DiscordMessage {
	var nonce string
	if json.Unmarshal(m.Nonce, &nonce) != nil && len(m.Nonce) > 0 && string(m.Nonce) != "null" {
		nonce = string(m.Nonce)
	}
	return application.DiscordMessage{ID: m.ID, ChannelID: m.ChannelID, AuthorID: m.Author.ID, AuthorIsBot: m.Author.Bot, Nonce: nonce, CreatedAt: m.Timestamp.UTC()}
}

func channelPath(id string) string { return "/channels/" + url.PathEscape(id) }
func messagePath(channel, id string) string {
	return channelPath(channel) + "/messages/" + url.PathEscape(id)
}

func (c *Client) CreateMessage(ctx context.Context, channel string, message application.DisplayMessage, nonce string) (application.DiscordMessage, error) {
	payload, err := messagePayload(message, false)
	if err != nil {
		return application.DiscordMessage{}, err
	}
	if nonce == "" {
		return application.DiscordMessage{}, rejected()
	}
	payload["nonce"] = nonce
	payload["enforce_nonce"] = true
	var out restMessage
	if err := c.request(ctx, "POST", channelPath(channel)+"/messages", "/channels/:channel/messages", channel, payload, &out); err != nil {
		return application.DiscordMessage{}, err
	}
	if out.ID == "" || out.ChannelID != channel {
		return application.DiscordMessage{}, indeterminate()
	}
	return out.message(), nil
}
func (c *Client) EditMessage(ctx context.Context, channel, id string, message application.DisplayMessage) error {
	payload, err := messagePayload(message, true)
	if err != nil {
		return err
	}
	return c.request(ctx, "PATCH", messagePath(channel, id), "/channels/:channel/messages/:message", channel, payload, nil)
}
func (c *Client) DeleteMessage(ctx context.Context, channel, id string) error {
	return c.request(ctx, "DELETE", messagePath(channel, id), "/channels/:channel/messages/:message", channel, nil, nil)
}
func (c *Client) BulkDeleteMessages(ctx context.Context, channel string, ids []string) error {
	if len(ids) < 2 || len(ids) > 100 {
		return rejected()
	}
	return c.request(ctx, "POST", channelPath(channel)+"/messages/bulk-delete", "/channels/:channel/messages/bulk-delete", channel, map[string]any{"messages": ids}, nil)
}
func (c *Client) GetMessage(ctx context.Context, channel, id string) (application.DiscordMessage, error) {
	var out restMessage
	if err := c.request(ctx, "GET", messagePath(channel, id), "/channels/:channel/messages/:message", channel, nil, &out); err != nil {
		return application.DiscordMessage{}, err
	}
	if out.ID != id || out.ChannelID != channel {
		return application.DiscordMessage{}, indeterminate()
	}
	return out.message(), nil
}
func (c *Client) ListMessages(ctx context.Context, channel, before string, limit int) ([]application.DiscordMessage, error) {
	if limit < 1 || limit > 100 {
		return nil, rejected()
	}
	query := url.Values{"limit": {strconv.Itoa(limit)}}
	if before != "" {
		query.Set("before", before)
	}
	var out []restMessage
	if err := c.request(ctx, "GET", channelPath(channel)+"/messages?"+query.Encode(), "/channels/:channel/messages", channel, nil, &out); err != nil {
		return nil, err
	}
	result := make([]application.DiscordMessage, 0, len(out))
	for _, message := range out {
		if message.ID == "" || message.ChannelID != channel {
			return nil, indeterminate()
		}
		result = append(result, message.message())
	}
	return result, nil
}

type restThread struct {
	Type     int    `json:"type"`
	ID       string `json:"id"`
	ParentID string `json:"parent_id"`
	OwnerID  string `json:"owner_id"`
	Metadata struct {
		Archived bool `json:"archived"`
	} `json:"thread_metadata"`
}

func (t restThread) thread() application.DiscordThread {
	return application.DiscordThread{ID: t.ID, ParentID: t.ParentID, OwnerID: t.OwnerID, Type: t.Type, Archived: t.Metadata.Archived}
}

func (c *Client) CreateThread(ctx context.Context, channel, parent, name string) (application.DiscordThread, error) {
	path, route := channelPath(channel)+"/threads", "/channels/:channel/threads"
	payload := map[string]any{"name": name, "auto_archive_duration": 1440}
	if parent != "" {
		path = messagePath(channel, parent) + "/threads"
		route = "/channels/:channel/messages/:message/threads"
	} else {
		payload["type"] = 11
	}
	var out restThread
	if err := c.request(ctx, "POST", path, route, channel, payload, &out); err != nil {
		return application.DiscordThread{}, err
	}
	if out.ID == "" || out.ParentID != channel {
		return application.DiscordThread{}, indeterminate()
	}
	return out.thread(), nil
}
func (c *Client) GetThread(ctx context.Context, id string) (application.DiscordThread, error) {
	var out restThread
	if err := c.request(ctx, "GET", channelPath(id), "/channels/:channel", id, nil, &out); err != nil {
		return application.DiscordThread{}, err
	}
	if out.ID != id || out.ParentID == "" {
		return application.DiscordThread{}, indeterminate()
	}
	return out.thread(), nil
}
func (c *Client) UnarchiveThread(ctx context.Context, id string) error {
	return c.request(ctx, "PATCH", channelPath(id), "/channels/:channel", id, map[string]any{"archived": false}, nil)
}
func (c *Client) PinMessage(ctx context.Context, channel, id string) error {
	return c.request(ctx, "PUT", channelPath(channel)+"/pins/"+url.PathEscape(id), "/channels/:channel/pins/:message", channel, nil, nil)
}
