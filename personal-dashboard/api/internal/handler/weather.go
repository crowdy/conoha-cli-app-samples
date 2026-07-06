package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"dashboard.crowdy.dev/api/internal/cache"
	"dashboard.crowdy.dev/api/internal/weather"
)

type WeatherHandler struct {
	Client     *weather.Client
	Cache      *cache.Repo
	OfficeCode string
	TTL        time.Duration
	Now        func() time.Time

	// Ctx scopes background refresh goroutines so they stop when the
	// process is shutting down (avoids "database is closed" during
	// shutdown). Wg lets the shutdown sequence wait for in-flight
	// refreshes. Both may be nil in tests — see bgContext/bgWg below.
	Ctx context.Context
	Wg  *sync.WaitGroup

	mu         sync.Mutex
	refreshing bool
}

func (h *WeatherHandler) bgContext() context.Context {
	if h.Ctx != nil {
		return h.Ctx
	}
	return context.Background()
}

func (h *WeatherHandler) startBG(fn func()) {
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

const weatherCacheKey = "weather"

func (h *WeatherHandler) Get(w http.ResponseWriter, r *http.Request) {
	entry, err := h.Cache.Get(r.Context(), weatherCacheKey)
	if err != nil {
		slog.Error("weather cache get", "err", err)
		writeError(w, http.StatusInternalServerError, "cache error")
		return
	}
	now := h.now()
	if entry != nil && !entry.IsStale(now, h.TTL) {
		h.writeEntry(w, entry)
		return
	}
	if entry != nil {
		// stale: return stale, refresh in background
		h.writeEntry(w, entry)
		h.startBG(func() { h.refresh(h.bgContext()) })
		return
	}
	// no cache yet: synchronous fetch
	snap, err := h.Client.Fetch(r.Context(), h.OfficeCode)
	if err != nil {
		_ = h.Cache.SetError(r.Context(), weatherCacheKey, err.Error())
		writeError(w, http.StatusBadGateway, "weather fetch failed: "+err.Error())
		return
	}
	payload, _ := json.Marshal(snap)
	_ = h.Cache.Set(r.Context(), weatherCacheKey, payload, now)
	writeJSON(w, http.StatusOK, map[string]any{"data": snap, "last_error": ""})
}

func (h *WeatherHandler) Refresh(w http.ResponseWriter, _ *http.Request) {
	h.startBG(func() { h.refresh(h.bgContext()) })
	w.WriteHeader(http.StatusAccepted)
}

func (h *WeatherHandler) refresh(ctx context.Context) {
	h.mu.Lock()
	if h.refreshing {
		h.mu.Unlock()
		return
	}
	h.refreshing = true
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		h.refreshing = false
		h.mu.Unlock()
	}()

	snap, err := h.Client.Fetch(ctx, h.OfficeCode)
	if err != nil {
		slog.Warn("weather refresh failed", "err", err)
		_ = h.Cache.SetError(ctx, weatherCacheKey, err.Error())
		return
	}
	payload, _ := json.Marshal(snap)
	if err := h.Cache.Set(ctx, weatherCacheKey, payload, h.now()); err != nil {
		slog.Error("weather cache set", "err", err)
	}
}

func (h *WeatherHandler) writeEntry(w http.ResponseWriter, e *cache.Entry) {
	var data any
	if len(e.Payload) > 0 {
		_ = json.Unmarshal(e.Payload, &data)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data, "last_error": e.LastError})
}

func (h *WeatherHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}
