package schedule

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Google struct {
	TokenURL     string // https://oauth2.googleapis.com/token
	APIBaseURL   string // https://www.googleapis.com/calendar/v3
	ClientID     string
	ClientSecret string
	RefreshToken string
	LabelStr     string
	HTTP         *http.Client
}

func NewGoogle(clientID, clientSecret, refreshToken, label string) *Google {
	return &Google{
		TokenURL:     "https://oauth2.googleapis.com/token",
		APIBaseURL:   "https://www.googleapis.com/calendar/v3",
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RefreshToken: refreshToken,
		LabelStr:     label,
		HTTP:         &http.Client{Timeout: 15 * time.Second},
	}
}

func (g *Google) Label() string  { return g.LabelStr }
func (g *Google) Source() string { return "google" }

func (g *Google) accessToken(ctx context.Context) (string, error) {
	form := url.Values{}
	form.Set("client_id", g.ClientID)
	form.Set("client_secret", g.ClientSecret)
	form.Set("refresh_token", g.RefreshToken)
	form.Set("grant_type", "refresh_token")
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, g.TokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := g.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("google token: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("google token http %d", resp.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("google token: empty")
	}
	return tok.AccessToken, nil
}

func (g *Google) Fetch(ctx context.Context, dayStart, dayEnd time.Time) ([]Item, error) {
	token, err := g.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	q.Set("timeMin", dayStart.UTC().Format(time.RFC3339))
	q.Set("timeMax", dayEnd.UTC().Format(time.RFC3339))
	q.Set("singleEvents", "true")
	q.Set("orderBy", "startTime")
	q.Set("maxResults", "200")
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		g.APIBaseURL+"/calendars/primary/events?"+q.Encode(), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := g.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("google events: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("google events http %d", resp.StatusCode)
	}
	var body struct {
		Items []struct {
			ID      string `json:"id"`
			Summary string `json:"summary"`
			Start   struct {
				DateTime string `json:"dateTime"`
				Date     string `json:"date"`
			} `json:"start"`
			End struct {
				DateTime string `json:"dateTime"`
				Date     string `json:"date"`
			} `json:"end"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("google events decode: %w", err)
	}
	out := make([]Item, 0, len(body.Items))
	for _, ev := range body.Items {
		st, en, allDay, err := parseGoogleTimes(ev.Start.DateTime, ev.Start.Date, ev.End.DateTime, ev.End.Date)
		if err != nil {
			continue
		}
		out = append(out, Item{
			ID:           "google:" + g.LabelStr + ":" + ev.ID,
			Source:       "google",
			AccountLabel: g.LabelStr,
			Title:        ev.Summary,
			StartAt:      st,
			EndAt:        en,
			AllDay:       allDay,
		})
	}
	return out, nil
}

func parseGoogleTimes(sdt, sdate, edt, edate string) (time.Time, time.Time, bool, error) {
	if sdt != "" && edt != "" {
		st, err := time.Parse(time.RFC3339, sdt)
		if err != nil {
			return time.Time{}, time.Time{}, false, err
		}
		en, err := time.Parse(time.RFC3339, edt)
		if err != nil {
			return time.Time{}, time.Time{}, false, err
		}
		return st, en, false, nil
	}
	if sdate != "" && edate != "" {
		st, err := time.Parse("2006-01-02", sdate)
		if err != nil {
			return time.Time{}, time.Time{}, false, err
		}
		en, err := time.Parse("2006-01-02", edate)
		if err != nil {
			return time.Time{}, time.Time{}, false, err
		}
		return st, en, true, nil
	}
	return time.Time{}, time.Time{}, false, fmt.Errorf("missing both dateTime and date")
}
