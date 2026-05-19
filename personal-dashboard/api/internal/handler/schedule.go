package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"dashboard.crowdy.dev/api/internal/cache"
	"dashboard.crowdy.dev/api/internal/schedule"
)

type ScheduleHandler struct {
	Cache    *cache.Repo
	Fetchers []schedule.Fetcher
	TTL      time.Duration
	Now      func() time.Time
	Location *time.Location

	// Ctx scopes background refresh goroutines so they stop on shutdown.
	// Wg lets the shutdown sequence wait for in-flight refreshes. Both may
	// be nil in tests.
	Ctx context.Context
	Wg  *sync.WaitGroup

	mu         sync.Mutex
	refreshing map[string]bool
}

func (h *ScheduleHandler) bgContext() context.Context {
	if h.Ctx != nil {
		return h.Ctx
	}
	return context.Background()
}

func (h *ScheduleHandler) startBG(fn func()) {
	if h.Wg != nil {
		h.Wg.Add(1)
		go func() {
			defer h.Wg.Done()
			fn()
		}()
		return
	}
	go fn()
}

func (h *ScheduleHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func (h *ScheduleHandler) loc() *time.Location {
	if h.Location != nil {
		return h.Location
	}
	return time.Local
}

func (h *ScheduleHandler) Get(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	dateKey, dayStart, dayEnd, err := h.resolveDay(day)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cacheKey := "schedule:" + dateKey
	entry, err := h.Cache.Get(r.Context(), cacheKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cache error")
		return
	}
	now := h.now()
	if entry != nil && !entry.IsStale(now, h.TTL) {
		h.writeEntry(w, entry)
		return
	}
	if entry != nil {
		h.writeEntry(w, entry)
		h.startBG(func() { h.refresh(h.bgContext(), cacheKey, dayStart, dayEnd) })
		return
	}
	items, errs := schedule.MergeAndFetch(r.Context(), h.Fetchers, dayStart, dayEnd)
	errMsg := joinErrors(errs)
	allFailed := len(h.Fetchers) > 0 && len(errs) == len(h.Fetchers)
	if !allFailed {
		payload, _ := json.Marshal(items)
		_ = h.Cache.Set(r.Context(), cacheKey, payload, now)
	}
	if errMsg != "" {
		_ = h.Cache.SetError(r.Context(), cacheKey, errMsg)
	}
	if items == nil {
		items = []schedule.Item{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": items, "last_error": errMsg})
}

func (h *ScheduleHandler) Refresh(w http.ResponseWriter, _ *http.Request) {
	for _, day := range []string{"today", "tomorrow"} {
		key, st, en, err := h.resolveDay(day)
		if err != nil {
			continue
		}
		cacheKey := "schedule:" + key
		dayStart, dayEnd := st, en
		h.startBG(func() { h.refresh(h.bgContext(), cacheKey, dayStart, dayEnd) })
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h *ScheduleHandler) refresh(ctx context.Context, cacheKey string, dayStart, dayEnd time.Time) {
	h.mu.Lock()
	if h.refreshing == nil {
		h.refreshing = map[string]bool{}
	}
	if h.refreshing[cacheKey] {
		h.mu.Unlock()
		return
	}
	h.refreshing[cacheKey] = true
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.refreshing, cacheKey)
		h.mu.Unlock()
	}()

	items, errs := schedule.MergeAndFetch(ctx, h.Fetchers, dayStart, dayEnd)
	if len(errs) == len(h.Fetchers) && len(h.Fetchers) > 0 {
		// all fetchers failed: keep stale cache, record error
		slog.Warn("schedule refresh: all fetchers failed", "key", cacheKey, "errs", errsToStrings(errs))
		_ = h.Cache.SetError(ctx, cacheKey, joinErrors(errs))
		return
	}
	payload, _ := json.Marshal(items)
	if err := h.Cache.Set(ctx, cacheKey, payload, h.now()); err != nil {
		slog.Error("schedule cache set", "err", err)
		return
	}
	if errMsg := joinErrors(errs); errMsg != "" {
		_ = h.Cache.SetError(ctx, cacheKey, errMsg)
	}
}

func (h *ScheduleHandler) writeEntry(w http.ResponseWriter, e *cache.Entry) {
	var items []schedule.Item
	if len(e.Payload) > 0 {
		_ = json.Unmarshal(e.Payload, &items)
	}
	if items == nil {
		items = []schedule.Item{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": items, "last_error": e.LastError})
}

func (h *ScheduleHandler) resolveDay(day string) (key string, start, end time.Time, err error) {
	loc := h.loc()
	now := h.now().In(loc)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	switch day {
	case "today":
		start = startOfToday
	case "tomorrow":
		start = startOfToday.Add(24 * time.Hour)
	default:
		return "", time.Time{}, time.Time{}, errors.New(`day must be "today" or "tomorrow"`)
	}
	end = start.Add(24 * time.Hour)
	key = start.Format("2006-01-02")
	return
}

// errsToStrings converts a map of errors to a map of strings for slog
// serialization. Without this, error values get JSON-marshaled as empty
// objects via reflection and the actual messages are lost.
func errsToStrings(errs map[string]error) map[string]string {
	out := make(map[string]string, len(errs))
	for k, v := range errs {
		out[k] = v.Error()
	}
	return out
}

func joinErrors(errs map[string]error) string {
	if len(errs) == 0 {
		return ""
	}
	keys := make([]string, 0, len(errs))
	for k := range errs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(errs))
	for _, k := range keys {
		parts = append(parts, k+": "+errs[k].Error())
	}
	return strings.Join(parts, "; ")
}
