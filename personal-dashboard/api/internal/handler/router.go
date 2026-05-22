package handler

import (
	"context"
	"net/http"
	"sync"
	"time"

	"dashboard.crowdy.dev/api/internal/cache"
	"dashboard.crowdy.dev/api/internal/config"
	"dashboard.crowdy.dev/api/internal/countdown"
	"dashboard.crowdy.dev/api/internal/schedule"
	"dashboard.crowdy.dev/api/internal/weather"
	"dashboard.crowdy.dev/api/internal/webfs"
)

type Deps struct {
	Cfg              *config.Config
	Cache            *cache.Repo
	Weather          *weather.Client
	Countdowns       *countdown.Repo
	ScheduleFetchers []schedule.Fetcher
	Location         *time.Location
	BrandName        string
	// Ctx is the lifecycle context for background refresh goroutines; cancel
	// it on shutdown to signal in-flight refreshes to stop. Wg tracks them
	// so the shutdown sequence can wait before closing the DB.
	Ctx context.Context
	Wg  *sync.WaitGroup
}

func NewMux(d *Deps) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	wH := &WeatherHandler{Client: d.Weather, Cache: d.Cache, OfficeCode: d.Cfg.JMAOfficeCode, TTL: d.Cfg.WeatherTTL, Ctx: d.Ctx, Wg: d.Wg}
	mux.HandleFunc("GET /api/weather", wH.Get)
	mux.HandleFunc("POST /api/weather/refresh", wH.Refresh)

	sH := &ScheduleHandler{Cache: d.Cache, Fetchers: d.ScheduleFetchers, TTL: d.Cfg.ScheduleTTL, Location: d.Location, Ctx: d.Ctx, Wg: d.Wg}
	mux.HandleFunc("GET /api/schedule", sH.Get)
	mux.HandleFunc("POST /api/schedule/refresh", sH.Refresh)

	cH := &CountdownHandler{Repo: d.Countdowns}
	mux.HandleFunc("GET /api/countdowns", cH.List)
	mux.HandleFunc("POST /api/countdowns", cH.Create)
	mux.HandleFunc("DELETE /api/countdowns/{id}", cH.Delete)

	scH := &ShortcutsHandler{Items: d.Cfg.Shortcuts}
	mux.HandleFunc("GET /api/config/shortcuts", scH.Get)

	bH := &BrandHandler{Name: d.BrandName}
	mux.HandleFunc("GET /api/config/brand", bH.Get)

	fileServer := http.FileServer(webfs.FS())
	mux.Handle("/", fileServer)

	return mux
}
