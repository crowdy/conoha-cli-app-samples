package schedule

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestOutlook_Fetch_RefreshesAndParses(t *testing.T) {
	var calledToken, calledEvents int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/tenant-X/oauth2/v2.0/token":
			calledToken++
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if r.Form.Get("grant_type") != "refresh_token" {
				t.Errorf("grant_type=%s", r.Form.Get("grant_type"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "ACCESS",
				"expires_in":   3600,
			})
		case r.URL.Path == "/v1.0/me/calendarview":
			calledEvents++
			if got := r.Header.Get("Authorization"); got != "Bearer ACCESS" {
				t.Errorf("auth header: %q", got)
			}
			if got, _ := url.QueryUnescape(r.URL.Query().Get("startDateTime")); got == "" {
				t.Error("startDateTime missing")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"value": []map[string]any{
					{
						"id":       "abc",
						"subject":  "Standup",
						"isAllDay": false,
						"start":    map[string]string{"dateTime": "2024-05-13T07:00:00.0000000", "timeZone": "UTC"},
						"end":      map[string]string{"dateTime": "2024-05-13T07:30:00.0000000", "timeZone": "UTC"},
					},
					{
						"id":       "xyz",
						"subject":  "Birthday",
						"isAllDay": true,
						"start":    map[string]string{"dateTime": "2024-05-13T00:00:00.0000000", "timeZone": "UTC"},
						"end":      map[string]string{"dateTime": "2024-05-14T00:00:00.0000000", "timeZone": "UTC"},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := &Outlook{
		TokenURL:     srv.URL + "/tenant-X/oauth2/v2.0/token",
		GraphBaseURL: srv.URL + "/v1.0",
		ClientID:     "cid",
		ClientSecret: "secret",
		RefreshToken: "rt",
		HTTP:         srv.Client(),
		LabelStr:     "outlook",
	}
	start := time.Date(2024, 5, 13, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	items, err := c.Fetch(context.Background(), start, end)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d", len(items))
	}
	if items[0].Title != "Standup" || items[0].AllDay {
		t.Errorf("first item wrong: %+v", items[0])
	}
	if !items[1].AllDay {
		t.Errorf("second item should be all_day: %+v", items[1])
	}
	if calledToken != 1 || calledEvents != 1 {
		t.Errorf("calls: token=%d events=%d", calledToken, calledEvents)
	}
}

func TestOutlook_Fetch_TokenError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "bad creds", http.StatusBadRequest)
	}))
	defer srv.Close()
	c := &Outlook{
		TokenURL:     srv.URL + "/t/oauth2/v2.0/token",
		GraphBaseURL: srv.URL + "/v1.0",
		HTTP:         srv.Client(),
	}
	_, err := c.Fetch(context.Background(), time.Now(), time.Now().Add(time.Hour))
	if err == nil {
		t.Fatal("expected error")
	}
}
