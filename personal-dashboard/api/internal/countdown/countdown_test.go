package countdown

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"dashboard.crowdy.dev/api/internal/store"
)

func newRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "c.db"), os.DirFS("../../migrations"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return New(db)
}

func TestCreate_RejectsPastTarget(t *testing.T) {
	r := newRepo(t)
	now := time.Now()
	_, err := r.Create(context.Background(), now.Add(-time.Minute), "x", now)
	if err == nil {
		t.Fatal("expected error for past target")
	}
}

func TestCreate_RejectsEmptyLabel(t *testing.T) {
	r := newRepo(t)
	now := time.Now()
	_, err := r.Create(context.Background(), now.Add(time.Hour), "", now)
	if err == nil {
		t.Fatal("expected error for empty label")
	}
}

func TestCreate_RejectsLongLabel(t *testing.T) {
	r := newRepo(t)
	now := time.Now()
	long := make([]byte, 201)
	for i := range long {
		long[i] = 'a'
	}
	_, err := r.Create(context.Background(), now.Add(time.Hour), string(long), now)
	if err == nil {
		t.Fatal("expected error for >200 chars")
	}
}

func TestListFuture(t *testing.T) {
	r := newRepo(t)
	now := time.Now()
	a, _ := r.Create(context.Background(), now.Add(2*time.Hour), "A", now)
	b, _ := r.Create(context.Background(), now.Add(time.Hour), "B", now)
	items, err := r.ListFuture(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("want 2, got %d", len(items))
	}
	// sorted by target_at ascending
	if items[0].ID != b.ID || items[1].ID != a.ID {
		t.Errorf("sort wrong: %+v", items)
	}
}

func TestListFuture_ExcludesPast(t *testing.T) {
	r := newRepo(t)
	now := time.UnixMilli(2_000_000_000_000)
	// insert directly to bypass validation
	_, err := r.db.ExecContext(context.Background(),
		"INSERT INTO countdowns(target_at,label,created_at) VALUES(?,?,?)",
		now.Add(-time.Hour).UnixMilli(), "past", now.UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	items, err := r.ListFuture(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Errorf("expected 0, got %d", len(items))
	}
}

func TestCreate_ReturnsUTCTime(t *testing.T) {
	r := newRepo(t)
	// Use a JST-style time as input
	jst, _ := time.LoadLocation("Asia/Tokyo")
	now := time.Date(2024, 5, 13, 10, 0, 0, 0, jst)
	target := time.Date(2024, 5, 13, 11, 0, 0, 0, jst)
	c, err := r.Create(context.Background(), target, "x", now)
	if err != nil {
		t.Fatal(err)
	}
	if c.TargetAt.Location() != time.UTC {
		t.Errorf("TargetAt location: %v, want UTC", c.TargetAt.Location())
	}
	// Round-trip via ListFuture
	items, err := r.ListFuture(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].TargetAt.Location() != time.UTC {
		t.Errorf("ListFuture[0].TargetAt location: %v", items[0].TargetAt.Location())
	}
	// The two representations of the same instant should be equal
	if !c.TargetAt.Equal(items[0].TargetAt) {
		t.Errorf("Create vs ListFuture mismatch: %v vs %v", c.TargetAt, items[0].TargetAt)
	}
}

func TestDelete(t *testing.T) {
	r := newRepo(t)
	now := time.Now()
	c, _ := r.Create(context.Background(), now.Add(time.Hour), "x", now)
	if err := r.Delete(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
	items, _ := r.ListFuture(context.Background(), now)
	if len(items) != 0 {
		t.Errorf("expected empty after delete, got %d", len(items))
	}
}
