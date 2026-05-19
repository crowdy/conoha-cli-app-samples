package schedule

import (
	"context"
	"time"
)

type Item struct {
	ID           string    `json:"id"`
	Source       string    `json:"source"` // "outlook" | "google"
	AccountLabel string    `json:"account_label"`
	Title        string    `json:"title"`
	StartAt      time.Time `json:"start_at"`
	EndAt        time.Time `json:"end_at"`
	AllDay       bool      `json:"all_day"`
}

type Fetcher interface {
	Label() string
	Source() string
	Fetch(ctx context.Context, dayStart, dayEnd time.Time) ([]Item, error)
}
