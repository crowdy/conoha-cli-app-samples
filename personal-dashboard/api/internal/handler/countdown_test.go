package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"dashboard.crowdy.dev/api/internal/countdown"
	"dashboard.crowdy.dev/api/internal/store"
)

func newCountdownHandler(t *testing.T, now time.Time) *CountdownHandler {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "c.db"), os.DirFS("../../migrations"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return &CountdownHandler{Repo: countdown.New(db), Now: func() time.Time { return now }}
}

func TestCountdown_CreateAndList(t *testing.T) {
	now := time.Date(2024, 5, 13, 10, 0, 0, 0, time.UTC)
	h := newCountdownHandler(t, now)

	body, _ := json.Marshal(map[string]string{
		"target_at": now.Add(time.Hour).Format(time.RFC3339),
		"label":     "gym",
	})
	rec := httptest.NewRecorder()
	h.Create(rec, httptest.NewRequest(http.MethodPost, "/api/countdowns", bytes.NewReader(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create code: %d body=%s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api/countdowns", nil))
	if rec.Code != 200 {
		t.Fatalf("list code: %d", rec.Code)
	}
	var items []countdown.Countdown
	if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Label != "gym" {
		t.Errorf("got %+v", items)
	}
}

func TestCountdown_CreateBadJSON(t *testing.T) {
	h := newCountdownHandler(t, time.Now())
	rec := httptest.NewRecorder()
	h.Create(rec, httptest.NewRequest(http.MethodPost, "/api/countdowns", bytes.NewReader([]byte("{"))))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code: %d", rec.Code)
	}
}

func TestCountdown_CreatePast(t *testing.T) {
	now := time.Date(2024, 5, 13, 10, 0, 0, 0, time.UTC)
	h := newCountdownHandler(t, now)
	body, _ := json.Marshal(map[string]string{
		"target_at": now.Add(-time.Minute).Format(time.RFC3339),
		"label":     "x",
	})
	rec := httptest.NewRecorder()
	h.Create(rec, httptest.NewRequest(http.MethodPost, "/api/countdowns", bytes.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code: %d", rec.Code)
	}
}
