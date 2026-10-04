package httptransport

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type nurseryHTTPRepository struct {
	application.Repository
	menus   map[string]domain.NurseryMenu
	channel *string
}

func (r *nurseryHTTPRepository) GetNurseryMenu(_ context.Context, date string) (*domain.NurseryMenu, error) {
	if menu, ok := r.menus[date]; ok {
		return &menu, nil
	}
	return nil, nil
}
func (r *nurseryHTTPRepository) NurseryMenus(_ context.Context, from, to string) ([]domain.NurseryMenu, error) {
	out := []domain.NurseryMenu{}
	for date, menu := range r.menus {
		if date >= from && date <= to {
			out = append(out, menu)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	return out, nil
}
func (r *nurseryHTTPRepository) PutNurseryMenu(_ context.Context, menu domain.NurseryMenu) error {
	r.menus[menu.Date] = menu
	return nil
}
func (r *nurseryHTTPRepository) DeleteNurseryMenu(_ context.Context, date string) error {
	delete(r.menus, date)
	return nil
}
func (r *nurseryHTTPRepository) GetNurseryMenuChannel(context.Context) (*string, error) {
	return r.channel, nil
}
func (r *nurseryHTTPRepository) PutNurseryMenuChannel(_ context.Context, channel string, _ time.Time) error {
	r.channel = &channel
	return nil
}

func nurseryServer(t *testing.T, repo *nurseryHTTPRepository) http.Handler {
	t.Helper()
	service := application.New(&handlerStore{repository: repo}, handlerClock{}, handlerIDs{})
	check := func(context.Context) error { return nil }
	routes, err := NewBusinessRoutes(service, check, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewHandler(Config{Token: "test-token", Check: check, Routes: routes})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func nurseryCall(t *testing.T, h http.Handler, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer test-token")
	for k, v := range headers {
		request.Header.Set(k, v)
	}
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	return response
}

func TestNurseryMenuWritesSucceedWithoutOperationHeaders(t *testing.T) {
	repo := &nurseryHTTPRepository{menus: map[string]domain.NurseryMenu{}}
	h := nurseryServer(t, repo)
	for _, c := range []struct{ method, path, body string }{
		{"POST", "/v1/nursery-menus/batch", `{"items":[{"date":"2026-10-02","lunch":"ご飯"},{"date":"2026-10-03","snack":"牛乳"}]}`},
		{"PUT", "/v1/nursery-menus/2026-10-04", `{"lunch":"パン","snack":" "}`},
		{"DELETE", "/v1/nursery-menus/2026-10-03", ``},
		{"PUT", "/v1/nursery-menu-channel", `{"channelId":"100"}`},
	} {
		if response := nurseryCall(t, h, c.method, c.path, c.body, nil); response.Code >= 300 {
			t.Fatalf("%s %s: %d %s", c.method, c.path, response.Code, response.Body.String())
		}
	}
	response := nurseryCall(t, h, "GET", "/v1/nursery-menus?from=2026-10-01&to=2026-10-31", "", nil)
	var menus []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &menus); err != nil || response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if len(menus) != 2 || menus[0]["date"] != "2026-10-02" || menus[0]["snack"] != nil || menus[1]["date"] != "2026-10-04" || menus[1]["lunch"] != "パン" || menus[1]["snack"] != nil {
		t.Fatalf("%v", menus)
	}
	response = nurseryCall(t, h, "GET", "/v1/nursery-menu-channel", "", nil)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"channelId":"100"`) {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestNurseryMenuIngredientsRoundTripAndValidate(t *testing.T) {
	repo := &nurseryHTTPRepository{menus: map[string]domain.NurseryMenu{}}
	h := nurseryServer(t, repo)
	response := nurseryCall(t, h, "POST", "/v1/nursery-menus/batch", `{"items":[{"date":"2026-10-02","lunch":"ご飯","snack":"牛乳","lunchIngredients":" 米、鮭 "}]}`, nil)
	var menus []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &menus); err != nil || response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if len(menus) != 1 || menus[0]["lunchIngredients"] != "米、鮭" || menus[0]["snackIngredients"] != nil {
		t.Fatalf("%v", menus)
	}
	if _, present := menus[0]["snackIngredients"]; !present {
		t.Fatal("omitted ingredients must be returned as null")
	}
	for _, body := range []string{
		`{"lunch":"ご飯","lunchIngredients":"` + strings.Repeat("米", 501) + `"}`,
		`{"lunch":"ご飯","snackIngredients":"米粉"}`,
	} {
		response := nurseryCall(t, h, "PUT", "/v1/nursery-menus/2026-10-03", body, nil)
		if response.Code != 422 || !strings.Contains(response.Body.String(), `"code":"invalid_input"`) {
			t.Errorf("%d %s", response.Code, response.Body.String())
		}
	}
	if _, saved := repo.menus["2026-10-03"]; saved {
		t.Fatal("invalid ingredients were saved")
	}
}

func TestNurseryMenuWritesRejectOperationHeaders(t *testing.T) {
	h := nurseryServer(t, &nurseryHTTPRepository{menus: map[string]domain.NurseryMenu{}})
	headers := map[string]string{"X-Actor-Id": "999", "X-Operation-Kind": "InitListCommand"}
	for _, c := range []struct{ method, path, body string }{
		{"POST", "/v1/nursery-menus/batch", `{"items":[{"date":"2026-10-02","lunch":"ご飯"}]}`},
		{"PUT", "/v1/nursery-menus/2026-10-02", `{"lunch":"ご飯"}`},
		{"DELETE", "/v1/nursery-menus/2026-10-02", ``},
		{"PUT", "/v1/nursery-menu-channel", `{"channelId":"100"}`},
	} {
		if response := nurseryCall(t, h, c.method, c.path, c.body, headers); response.Code != 400 {
			t.Fatalf("%s %s: %d", c.method, c.path, response.Code)
		}
	}
}

func TestNurseryMenuFailuresMapToAPIErrors(t *testing.T) {
	repo := &nurseryHTTPRepository{menus: map[string]domain.NurseryMenu{}}
	h := nurseryServer(t, repo)
	for _, c := range []struct {
		method, path, body, token string
		status                    int
		code                      string
	}{
		{"GET", "/v1/nursery-menus/2026-10-02", "", "test-token", 404, "not_found"},
		{"DELETE", "/v1/nursery-menus/2026-10-02", "", "test-token", 404, "not_found"},
		{"GET", "/v1/nursery-menu-channel", "", "test-token", 404, "not_found"},
		{"GET", "/v1/nursery-menus/2026-02-30", "", "test-token", 422, "invalid_input"},
		{"GET", "/v1/nursery-menus?from=2026-10-02&to=2026-10-01", "", "test-token", 422, "invalid_input"},
		{"PUT", "/v1/nursery-menus/2026-10-02", `{"lunch":" "}`, "test-token", 422, "invalid_input"},
		{"POST", "/v1/nursery-menus/batch", `{"items":[{"date":"2026-10-02","lunch":"a"},{"date":"2026-10-02","lunch":"b"}]}`, "test-token", 422, "invalid_input"},
		{"GET", "/v1/nursery-menus/2026-10-02", "", "wrong", 401, "unauthorized"},
	} {
		request := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+c.token)
		response := httptest.NewRecorder()
		h.ServeHTTP(response, request)
		if response.Code != c.status || !strings.Contains(response.Body.String(), `"code":"`+c.code+`"`) {
			t.Errorf("%s %s: %d %s", c.method, c.path, response.Code, response.Body.String())
		}
	}
	if len(repo.menus) != 0 {
		t.Fatal("rejected requests saved menus", repo.menus)
	}
}

func TestExistingWritesStillRequireOperationHeaders(t *testing.T) {
	h := nurseryServer(t, &nurseryHTTPRepository{menus: map[string]domain.NurseryMenu{}})
	if response := nurseryCall(t, h, "PUT", "/v1/lists/100", `{"channelId":"100","listTitle":"l","defaultCategory":"c"}`, nil); response.Code != 400 {
		t.Fatal(response.Code, response.Body.String())
	}
}
