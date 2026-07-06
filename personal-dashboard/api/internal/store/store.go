package store

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

// Open initializes the SQLite database at dbPath and runs goose migrations
// from migrationsFS. The FS should have SQL migration files at its root
// (i.e. accessed via path ".").
func Open(ctx context.Context, dbPath string, migrationsFS fs.FS) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir db parent: %w", err)
	}
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("sqlite3"); err != nil {
		return nil, fmt.Errorf("goose dialect: %w", err)
	}
	goose.SetBaseFS(migrationsFS)
	if err := goose.UpContext(ctx, db, "."); err != nil {
		return nil, fmt.Errorf("goose up: %w", err)
	}
	return db, nil
}
