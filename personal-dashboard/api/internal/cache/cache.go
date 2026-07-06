package cache

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type Entry struct {
	Payload   []byte
	FetchedAt time.Time
	LastError string
}

func (e *Entry) IsStale(now time.Time, ttl time.Duration) bool {
	return now.Sub(e.FetchedAt) >= ttl
}

type Repo struct{ db *sql.DB }

func New(db *sql.DB) *Repo { return &Repo{db: db} }

func (r *Repo) Get(ctx context.Context, key string) (*Entry, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT payload, fetched_at, COALESCE(last_error,'') FROM cache WHERE key = ?`, key)
	var (
		payload   string
		fetchedAt int64
		lastError string
	)
	if err := row.Scan(&payload, &fetchedAt, &lastError); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &Entry{
		Payload:   []byte(payload),
		FetchedAt: time.UnixMilli(fetchedAt),
		LastError: lastError,
	}, nil
}

// Set writes payload and clears last_error.
func (r *Repo) Set(ctx context.Context, key string, payload []byte, fetchedAt time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO cache(key, payload, fetched_at, last_error)
		   VALUES(?, ?, ?, NULL)
		 ON CONFLICT(key) DO UPDATE SET
		   payload    = excluded.payload,
		   fetched_at = excluded.fetched_at,
		   last_error = NULL`,
		key, string(payload), fetchedAt.UnixMilli())
	return err
}

// SetError records an error without touching payload/fetched_at.
// If no row exists yet, it inserts one with empty payload.
func (r *Repo) SetError(ctx context.Context, key, msg string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO cache(key, payload, fetched_at, last_error)
		   VALUES(?, '', 0, ?)
		 ON CONFLICT(key) DO UPDATE SET last_error = excluded.last_error`,
		key, msg)
	return err
}

// DeleteOlderThan removes rows whose key starts with prefix and is lexicographically less than prefix+minSuffix.
// For schedule:YYYY-MM-DD this works because the date suffix sorts correctly.
func (r *Repo) DeleteOlderThan(ctx context.Context, prefix, minSuffix string) error {
	minKey := prefix + minSuffix
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM cache WHERE key LIKE ? || '%' AND key < ?`,
		prefix, minKey)
	return err
}
