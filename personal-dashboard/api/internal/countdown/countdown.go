package countdown

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type Countdown struct {
	ID        int64     `json:"id"`
	TargetAt  time.Time `json:"target_at"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"created_at"`
}

type Repo struct{ db *sql.DB }

func New(db *sql.DB) *Repo { return &Repo{db: db} }

const maxLabelLen = 200

func (r *Repo) Create(ctx context.Context, targetAt time.Time, label string, now time.Time) (*Countdown, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return nil, errors.New("label is required")
	}
	if len(label) > maxLabelLen {
		return nil, fmt.Errorf("label exceeds %d chars", maxLabelLen)
	}
	if !targetAt.After(now) {
		return nil, errors.New("target_at must be in the future")
	}
	res, err := r.db.ExecContext(ctx,
		"INSERT INTO countdowns(target_at,label,created_at) VALUES(?,?,?)",
		targetAt.UnixMilli(), label, now.UnixMilli())
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return &Countdown{
		ID:        id,
		TargetAt:  time.UnixMilli(targetAt.UnixMilli()).UTC(),
		Label:     label,
		CreatedAt: time.UnixMilli(now.UnixMilli()).UTC(),
	}, nil
}

func (r *Repo) ListFuture(ctx context.Context, now time.Time) ([]Countdown, error) {
	rows, err := r.db.QueryContext(ctx,
		"SELECT id, target_at, label, created_at FROM countdowns WHERE target_at > ? ORDER BY target_at ASC",
		now.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Countdown
	for rows.Next() {
		var (
			c               Countdown
			target, created int64
		)
		if err := rows.Scan(&c.ID, &target, &c.Label, &created); err != nil {
			return nil, err
		}
		c.TargetAt = time.UnixMilli(target).UTC()
		c.CreatedAt = time.UnixMilli(created).UTC()
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, "DELETE FROM countdowns WHERE id = ?", id)
	return err
}
