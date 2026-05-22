package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"dashboard.crowdy.dev/api/internal/cache"
	"dashboard.crowdy.dev/api/internal/schedule"
	"dashboard.crowdy.dev/api/internal/store"
)

type stubFetcher struct {
	label, source string
	items         []schedule.Item
	err           error
}

func (s *stubFetcher) Label() string  { return s.label }
func (s *stubFetcher) Source() string { return s.source }
func (s *stubFetcher) Fetch(ctx context.Context, _, _ time.Time) ([]schedule.Item, error) {
	return s.items, s.err
}

func newScheduleHandler(t *testing.T, now time.Time, fs []schedule.Fetcher) *ScheduleHandler {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "s.db"), os.DirFS("../../migrations"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return &ScheduleHandler{
		Cache:    cache.New(db),
		Fetchers: fs,
		TTL:      5 * time.Minute,
		Now:      func() time.Time { return now },
		Location: time.UTC,
	}
}

func TestSchedule_Get_TodayCachedAfterFirstCall(t *testing.T) {
	now := time.Date(2024, 5, 13, 9, 0, 0, 0, time.UTC)
	st := time.Date(2024, 5, 13, 10, 0, 0, 0, time.UTC)
	f := &stubFetcher{label: "a", source: "outlook", items: []schedule.Item{
		{ID: "x", Title: "X", StartAt: st, EndAt: st.Add(time.Hour)},
	}}
	h := newScheduleHandler(t, now, []schedule.Fetcher{f})

	rec1 := httptest.NewRecorder()
	h.Get(rec1, httptest.NewRequest(http.MethodGet, "/api/schedule?day=today", nil))
	if rec1.Code != 200 {
		t.Fatalf("first code: %d body=%s", rec1.Code, rec1.Body.String())
	}

	// Replace fetcher with one that would error if called; cache hit means it shouldn't be invoked.
	h.Fetchers = []schedule.Fetcher{&stubFetcher{label: "a", source: "outlook", err: http.ErrServerClosed}}

	rec2 := httptest.NewRecorder()
	h.Get(rec2, httptest.NewRequest(http.MethodGet, "/api/schedule?day=today", nil))
	if rec2.Code != 200 {
		t.Fatalf("second code: %d body=%s", rec2.Code, rec2.Body.String())
	}
	var got struct {
		Data []schedule.Item `json:"data"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Data) != 1 || got.Data[0].ID != "x" {
		t.Errorf("cached items wrong: %+v", got.Data)
	}
}

func TestSchedule_Get_EmptyFetchersReturnsEmptyArray(t *testing.T) {
	now := time.Date(2024, 5, 13, 9, 0, 0, 0, time.UTC)
	h := newScheduleHandler(t, now, nil) // no fetchers
	rec := httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/api/schedule?day=today", nil))
	if rec.Code != 200 {
		t.Fatalf("code: %d body=%s", rec.Code, rec.Body.String())
	}
	// The literal JSON should be `[]`, not `null`
	if !strings.Contains(rec.Body.String(), `"data":[]`) {
		t.Errorf("expected data:[] in response, got: %s", rec.Body.String())
	}
}

func TestSchedule_Get_BadDay(t *testing.T) {
	h := newScheduleHandler(t, time.Now(), nil)
	rec := httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/api/schedule?day=neverday", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code: %d", rec.Code)
	}
}

func TestSchedule_Get_PartialFailureWritesPayloadAndError(t *testing.T) {
	now := time.Date(2024, 5, 13, 9, 0, 0, 0, time.UTC)
	st := time.Date(2024, 5, 13, 10, 0, 0, 0, time.UTC)
	h := newScheduleHandler(t, now, []schedule.Fetcher{
		&stubFetcher{label: "a", source: "outlook", items: []schedule.Item{
			{ID: "x", Title: "X", StartAt: st, EndAt: st.Add(time.Hour)},
		}},
		&stubFetcher{label: "b", source: "google", err: errors.New("boom")},
	})

	rec := httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/api/schedule?day=today", nil))
	if rec.Code != 200 {
		t.Fatalf("code: %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Data      []schedule.Item `json:"data"`
		LastError string          `json:"last_error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Data) != 1 || got.Data[0].ID != "x" {
		t.Errorf("expected the one surviving item, got %+v", got.Data)
	}
	if got.LastError == "" || !strings.Contains(got.LastError, "google:b") {
		t.Errorf("expected last_error mentioning google:b, got %q", got.LastError)
	}

	// Now drop the working fetcher entirely; cache should still serve the previously-saved item.
	h.Fetchers = []schedule.Fetcher{&stubFetcher{label: "a", source: "outlook", err: http.ErrServerClosed}}
	rec2 := httptest.NewRecorder()
	h.Get(rec2, httptest.NewRequest(http.MethodGet, "/api/schedule?day=today", nil))
	var got2 struct {
		Data []schedule.Item `json:"data"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &got2); err != nil {
		t.Fatal(err)
	}
	if len(got2.Data) != 1 || got2.Data[0].ID != "x" {
		t.Errorf("expected cached item to be served on second call, got %+v", got2.Data)
	}
}

type countingFetcher struct {
	stubFetcher
	calls *int32
}

func (c *countingFetcher) Fetch(ctx context.Context, ds, de time.Time) ([]schedule.Item, error) {
	atomic.AddInt32(c.calls, 1)
	return c.stubFetcher.Fetch(ctx, ds, de)
}

func TestSchedule_Get_StaleReturnsStaleAndRefreshes(t *testing.T) {
	jst, _ := time.LoadLocation("Asia/Tokyo")
	now := time.Date(2024, 5, 13, 9, 0, 0, 0, jst)
	stale := time.Date(2024, 5, 13, 10, 0, 0, 0, time.UTC)
	fresh := time.Date(2024, 5, 13, 11, 0, 0, 0, time.UTC)

	// counter fetcher to assert refresh ran
	var calls int32
	fresher := &countingFetcher{
		stubFetcher: stubFetcher{label: "a", source: "outlook", items: []schedule.Item{
			{ID: "fresh", Title: "Fresh", StartAt: fresh, EndAt: fresh.Add(time.Hour)},
		}},
		calls: &calls,
	}
	h := newScheduleHandler(t, now, []schedule.Fetcher{fresher})
	h.Location = jst

	// Manually prime cache with stale entry (fetched_at = 1h ago, TTL is 5min)
	// The cache key for today=2024-05-13 in JST is "schedule:2024-05-13"
	staleItems := []schedule.Item{{ID: "stale", Title: "Stale", StartAt: stale, EndAt: stale.Add(time.Hour)}}
	payload, _ := json.Marshal(staleItems)
	if err := h.Cache.Set(context.Background(), "schedule:2024-05-13", payload, now.Add(-1*time.Hour)); err != nil {
		t.Fatal(err)
	}

	// Get returns stale immediately + fires async refresh
	rec := httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/api/schedule?day=today", nil))
	if rec.Code != 200 {
		t.Fatalf("code: %d body=%s", rec.Code, rec.Body.String())
	}
	// First call returns STALE data immediately
	if !strings.Contains(rec.Body.String(), `"stale"`) {
		t.Errorf("expected stale data in first response: %s", rec.Body.String())
	}

	// Wait for background refresh
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&calls) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if atomic.LoadInt32(&calls) == 0 {
		t.Fatal("background refresh did not run within 2s")
	}

	// Give the refresh goroutine a brief moment to finish writing the cache
	// before issuing the follow-up request.
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		rec2 := httptest.NewRecorder()
		h.Get(rec2, httptest.NewRequest(http.MethodGet, "/api/schedule?day=today", nil))
		if strings.Contains(rec2.Body.String(), `"fresh"`) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Errorf("expected fresh data in follow-up response within 2s")
}
