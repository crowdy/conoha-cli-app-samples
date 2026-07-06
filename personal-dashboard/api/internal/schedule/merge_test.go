package schedule

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeFetcher struct {
	label  string
	source string
	items  []Item
	err    error
}

func (f *fakeFetcher) Label() string  { return f.label }
func (f *fakeFetcher) Source() string { return f.source }
func (f *fakeFetcher) Fetch(ctx context.Context, _, _ time.Time) ([]Item, error) {
	return f.items, f.err
}

func TestMergeAndSort_OK(t *testing.T) {
	t1 := time.Date(2024, 5, 13, 9, 0, 0, 0, time.UTC)
	t2 := time.Date(2024, 5, 13, 11, 0, 0, 0, time.UTC)
	t3 := time.Date(2024, 5, 13, 10, 0, 0, 0, time.UTC)
	fs := []Fetcher{
		&fakeFetcher{label: "a", source: "outlook", items: []Item{{ID: "a1", StartAt: t1, EndAt: t1.Add(time.Hour)}}},
		&fakeFetcher{label: "b", source: "google", items: []Item{
			{ID: "b1", StartAt: t2, EndAt: t2.Add(time.Hour)},
			{ID: "b2", StartAt: t3, EndAt: t3.Add(time.Hour)},
		}},
	}
	items, errs := MergeAndFetch(context.Background(), fs, t1, t2.Add(2*time.Hour))
	if len(errs) != 0 {
		t.Errorf("unexpected errors: %v", errs)
	}
	if len(items) != 3 {
		t.Fatalf("want 3 items, got %d", len(items))
	}
	if items[0].ID != "a1" || items[1].ID != "b2" || items[2].ID != "b1" {
		t.Errorf("wrong sort order: %+v", items)
	}
}

func TestMergeAndSort_PartialFailure(t *testing.T) {
	t1 := time.Date(2024, 5, 13, 9, 0, 0, 0, time.UTC)
	fs := []Fetcher{
		&fakeFetcher{label: "a", source: "outlook", err: errors.New("auth bust")},
		&fakeFetcher{label: "b", source: "google", items: []Item{{ID: "b1", StartAt: t1, EndAt: t1.Add(time.Hour)}}},
	}
	items, errs := MergeAndFetch(context.Background(), fs, t1, t1.Add(24*time.Hour))
	if len(items) != 1 || items[0].ID != "b1" {
		t.Errorf("expected only b1: %+v", items)
	}
	if len(errs) != 1 || !errors.Is(errs["outlook:a"], errs["outlook:a"]) {
		t.Errorf("expected one error keyed by source:label, got %+v", errs)
	}
}
