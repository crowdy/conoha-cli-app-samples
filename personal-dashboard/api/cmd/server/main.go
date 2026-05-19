package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"dashboard.crowdy.dev/api/internal/cache"
	"dashboard.crowdy.dev/api/internal/config"
	"dashboard.crowdy.dev/api/internal/countdown"
	"dashboard.crowdy.dev/api/internal/handler"
	"dashboard.crowdy.dev/api/internal/schedule"
	"dashboard.crowdy.dev/api/internal/store"
	"dashboard.crowdy.dev/api/internal/weather"
	"dashboard.crowdy.dev/api/migrations"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}

	jst, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		slog.Warn("Asia/Tokyo timezone not available, falling back to time.Local", "err", err)
		jst = time.Local
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(ctx, cfg.DBPath, migrations.FS)
	if err != nil {
		slog.Error("store.Open", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	cacheRepo := cache.New(db)
	// Best-effort cleanup of past-day schedule rows.
	today := time.Now().In(jst).Format("2006-01-02")
	_ = cacheRepo.DeleteOlderThan(ctx, "schedule:", today)

	weatherClient := weather.New(cfg.JMACityLabel)

	var fetchers []schedule.Fetcher
	if cfg.MSTenantID != "" {
		fetchers = append(fetchers, schedule.NewOutlook(cfg.MSTenantID, cfg.MSClientID, cfg.MSClientSecret, cfg.MSRefreshToken, "outlook"))
	}
	for _, ga := range cfg.GoogleAccounts {
		fetchers = append(fetchers, schedule.NewGoogle(ga.ClientID, ga.ClientSecret, ga.RefreshToken, ga.Label))
	}

	var wg sync.WaitGroup
	deps := &handler.Deps{
		Cfg:              cfg,
		Cache:            cacheRepo,
		Weather:          weatherClient,
		Countdowns:       countdown.New(db),
		ScheduleFetchers: fetchers,
		Location:         jst,
		BrandName:        cfg.BrandName,
		Ctx:              ctx,
		Wg:               &wg,
	}

	mux := handler.NewMux(deps)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		slog.Info("listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)

	// Wait for background refresh goroutines to finish (or time out) before
	// the deferred db.Close() runs, so we don't hit "database is closed"
	// errors on in-flight refreshes.
	waitCtx, cancelWait := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelWait()
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-waitCtx.Done():
		slog.Warn("refresh goroutines did not finish in time")
	}

	slog.Info("shutdown complete")
}
