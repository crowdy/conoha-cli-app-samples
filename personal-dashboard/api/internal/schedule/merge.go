package schedule

import (
	"context"
	"sort"
	"sync"
	"time"
)

// MergeAndFetch runs all fetchers in parallel and returns sorted items
// plus per-source errors (keyed by "source:label"). Partial failure is allowed.
func MergeAndFetch(ctx context.Context, fetchers []Fetcher, dayStart, dayEnd time.Time) ([]Item, map[string]error) {
	var (
		mu   sync.Mutex
		out  []Item
		errs = map[string]error{}
		wg   sync.WaitGroup
	)
	for _, f := range fetchers {
		wg.Add(1)
		go func(f Fetcher) {
			defer wg.Done()
			items, err := f.Fetch(ctx, dayStart, dayEnd)
			mu.Lock()
			defer mu.Unlock()
			key := f.Source() + ":" + f.Label()
			if err != nil {
				errs[key] = err
				return
			}
			out = append(out, items...)
		}(f)
	}
	wg.Wait()
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].StartAt.Equal(out[j].StartAt) {
			return out[i].StartAt.Before(out[j].StartAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, errs
}
