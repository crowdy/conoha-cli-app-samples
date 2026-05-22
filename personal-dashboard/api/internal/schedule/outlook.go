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

type Outlook struct {
	TokenURL     string // https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
	GraphBaseURL string // https://graph.microsoft.com/v1.0
	ClientID     string
	ClientSecret string
	RefreshToken string
	HTTP         *http.Client
	LabelStr     string
}

func NewOutlook(tenant, clientID, clientSecret, refreshToken, label string) *Outlook {
	return &Outlook{
		TokenURL:     "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token",
		GraphBaseURL: "https://graph.microsoft.com/v1.0",
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RefreshToken: refreshToken,
		HTTP:         &http.Client{Timeout: 15 * time.Second},
		LabelStr:     label,
	}
}

func (o *Outlook) Label() string  { return o.LabelStr }
func (o *Outlook) Source() string { return "outlook" }

func (o *Outlook) accessToken(ctx context.Context) (string, error) {
	form := url.Values{}
	form.Set("client_id", o.ClientID)
	form.Set("client_secret", o.ClientSecret)
	form.Set("refresh_token", o.RefreshToken)
	form.Set("grant_type", "refresh_token")
	form.Set("scope", "https://graph.microsoft.com/.default offline_access")

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, o.TokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := o.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("outlook token: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("outlook token http %d", resp.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", fmt.Errorf("outlook token decode: %w", err)
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("outlook token: empty access_token")
	}
	return tok.AccessToken, nil
}

func (o *Outlook) Fetch(ctx context.Context, dayStart, dayEnd time.Time) ([]Item, error) {
	token, err := o.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	q.Set("startDateTime", dayStart.UTC().Format("2006-01-02T15:04:05.000"))
	q.Set("endDateTime", dayEnd.UTC().Format("2006-01-02T15:04:05.000"))
	q.Set("$top", "200")
	q.Set("$orderby", "start/dateTime")

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, o.GraphBaseURL+"/me/calendarview?"+q.Encode(), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Prefer", `outlook.timezone="UTC"`)
	resp, err := o.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("outlook events: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("outlook events http %d", resp.StatusCode)
	}
	var body struct {
		Value []struct {
			ID       string `json:"id"`
			Subject  string `json:"subject"`
			IsAllDay bool   `json:"isAllDay"`
			Start    struct {
				DateTime string `json:"dateTime"`
				TimeZone string `json:"timeZone"`
			} `json:"start"`
			End struct {
				DateTime string `json:"dateTime"`
				TimeZone string `json:"timeZone"`
			} `json:"end"`
		} `json:"value"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("outlook events decode: %w", err)
	}

	items := make([]Item, 0, len(body.Value))
	for _, ev := range body.Value {
		st, err := parseGraphTime(ev.Start.DateTime)
		if err != nil {
			continue
		}
		en, err := parseGraphTime(ev.End.DateTime)
		if err != nil {
			continue
		}
		items = append(items, Item{
			ID:           "outlook:" + ev.ID,
			Source:       "outlook",
			AccountLabel: o.LabelStr,
			Title:        ev.Subject,
			StartAt:      st,
			EndAt:        en,
			AllDay:       ev.IsAllDay,
		})
	}
	return items, nil
}

// MS Graph returns dateTime like "2024-05-13T07:00:00.0000000".
// With Prefer: outlook.timezone="UTC", these are UTC wall-clock; we treat as UTC.
func parseGraphTime(s string) (time.Time, error) {
	if i := strings.IndexByte(s, '.'); i >= 0 {
		s = s[:i]
	}
	return time.ParseInLocation("2006-01-02T15:04:05", s, time.UTC)
}
