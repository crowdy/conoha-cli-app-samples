package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenAndMigrate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(context.Background(), path, os.DirFS("../../migrations"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	row := db.QueryRow("SELECT count(*) FROM countdowns")
	var n int
	if err := row.Scan(&n); err != nil {
		t.Fatalf("countdowns scan: %v", err)
	}
	if n != 0 {
		t.Errorf("expected empty countdowns, got %d", n)
	}

	row = db.QueryRow("SELECT count(*) FROM cache")
	if err := row.Scan(&n); err != nil {
		t.Fatalf("cache scan: %v", err)
	}
}

func TestOpenIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	for i := 0; i < 2; i++ {
		db, err := Open(context.Background(), path, os.DirFS("../../migrations"))
		if err != nil {
			t.Fatalf("iteration %d: %v", i, err)
		}
		db.Close()
	}
}
