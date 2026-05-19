package schedule

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGoogle_Fetch(t *testing.T) {
	var seenAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "G-ACCESS", "expires_in": 3600,
			})
		case "/calendar/v3/calendars/primary/events":
			seenAuth = r.Header.Get("Authorization")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{
					{
						"id":      "ev1",
						"summary": "Lunch",
						"start":   map[string]string{"dateTime": "2024-05-13T12:00:00+09:00"},
						"end":     map[string]string{"dateTime": "2024-05-13T13:00:00+09:00"},
					},
					{
						"id":      "ev2",
						"summary": "OOO",
						"start":   map[string]string{"date": "2024-05-13"},
						"end":     map[string]string{"date": "2024-05-14"},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	g := &Google{
		TokenURL:     srv.URL + "/token",
		APIBaseURL:   srv.URL + "/calendar/v3",
		ClientID:     "id",
		ClientSecret: "sec",
		RefreshToken: "rt",
		LabelStr:     "crowdy",
		HTTP:         srv.Client(),
	}
	start := time.Date(2024, 5, 13, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	items, err := g.Fetch(context.Background(), start, end)
	if err != nil {
		t.Fatal(err)
	}
	if seenAuth != "Bearer G-ACCESS" {
		t.Errorf("auth: %q", seenAuth)
	}
	if len(items) != 2 {
		t.Fatalf("want 2, got %d", len(items))
	}
	if items[0].AllDay {
		t.Errorf("first should not be all-day")
	}
	if !items[1].AllDay {
		t.Errorf("second should be all-day")
	}
	if items[1].EndAt.Sub(items[1].StartAt) != 24*time.Hour {
		t.Errorf("all-day duration: %v", items[1].EndAt.Sub(items[1].StartAt))
	}
}
