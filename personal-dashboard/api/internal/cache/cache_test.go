package cache

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"dashboard.crowdy.dev/api/internal/store"
)

func newDB(t *testing.T) *Repo {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "c.db"), os.DirFS("../../migrations"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return New(db)
}

func TestGetMissing(t *testing.T) {
	r := newDB(t)
	got, err := r.Get(context.Background(), "missing")
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestSetAndGet(t *testing.T) {
	r := newDB(t)
	ctx := context.Background()
	now := time.UnixMilli(1_700_000_000_000)
	if err := r.Set(ctx, "k", []byte(`{"x":1}`), now); err != nil {
		t.Fatal(err)
	}
	got, err := r.Get(ctx, "k")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected entry")
	}
	if string(got.Payload) != `{"x":1}` {
		t.Errorf("payload: %s", got.Payload)
	}
	if !got.FetchedAt.Equal(now) {
		t.Errorf("fetched_at: %v != %v", got.FetchedAt, now)
	}
	if got.LastError != "" {
		t.Errorf("last_error should be empty: %q", got.LastError)
	}
}

func TestSetClearsError(t *testing.T) {
	r := newDB(t)
	ctx := context.Background()
	now := time.UnixMilli(1_700_000_000_000)
	if err := r.SetError(ctx, "k", "boom"); err != nil {
		t.Fatal(err)
	}
	if err := r.Set(ctx, "k", []byte(`{}`), now); err != nil {
		t.Fatal(err)
	}
	got, _ := r.Get(ctx, "k")
	if got.LastError != "" {
		t.Errorf("LastError not cleared: %q", got.LastError)
	}
}

func TestSetErrorPreservesPayload(t *testing.T) {
	r := newDB(t)
	ctx := context.Background()
	now := time.UnixMilli(1_700_000_000_000)
	_ = r.Set(ctx, "k", []byte(`{"old":true}`), now)
	if err := r.SetError(ctx, "k", "fetch failed"); err != nil {
		t.Fatal(err)
	}
	got, _ := r.Get(ctx, "k")
	if string(got.Payload) != `{"old":true}` {
		t.Errorf("payload was overwritten: %s", got.Payload)
	}
	if got.LastError != "fetch failed" {
		t.Errorf("LastError not set: %q", got.LastError)
	}
}

func TestIsStale(t *testing.T) {
	now := time.UnixMilli(2_000_000_000_000)
	fresh := &Entry{FetchedAt: now.Add(-2 * time.Minute)}
	stale := &Entry{FetchedAt: now.Add(-10 * time.Minute)}
	if fresh.IsStale(now, 5*time.Minute) {
		t.Error("fresh should not be stale")
	}
	if !stale.IsStale(now, 5*time.Minute) {
		t.Error("stale should be stale")
	}
}

func TestDeletePrefix(t *testing.T) {
	r := newDB(t)
	ctx := context.Background()
	now := time.UnixMilli(1_700_000_000_000)
	_ = r.Set(ctx, "schedule:2024-01-01", []byte(`{}`), now)
	_ = r.Set(ctx, "schedule:2024-01-02", []byte(`{}`), now)
	_ = r.Set(ctx, "weather", []byte(`{}`), now)
	if err := r.DeleteOlderThan(ctx, "schedule:", "2024-01-02"); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.Get(ctx, "schedule:2024-01-01"); got != nil {
		t.Errorf("expected schedule:2024-01-01 deleted")
	}
	if got, _ := r.Get(ctx, "schedule:2024-01-02"); got == nil {
		t.Errorf("expected schedule:2024-01-02 retained")
	}
	if got, _ := r.Get(ctx, "weather"); got == nil {
		t.Errorf("expected weather retained")
	}
}
