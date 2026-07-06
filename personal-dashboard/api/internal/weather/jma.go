package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

type Snapshot struct {
	CityLabel         string `json:"city_label"`
	CurrentTempC      *int   `json:"current_temp_c,omitempty"`
	CurrentCondition  string `json:"current_condition"`
	ForecastHighC     *int   `json:"forecast_high_c,omitempty"`
	ForecastLowC      *int   `json:"forecast_low_c,omitempty"`
	ForecastCondition string `json:"forecast_condition"`
	FetchedAt         string `json:"fetched_at"`
}

type Client struct {
	BaseURL   string // e.g. "https://www.jma.go.jp/bosai/forecast/data/forecast"
	HTTP      *http.Client
	CityLabel string
}

func New(cityLabel string) *Client {
	return &Client{
		BaseURL:   "https://www.jma.go.jp/bosai/forecast/data/forecast",
		HTTP:      &http.Client{Timeout: 10 * time.Second},
		CityLabel: cityLabel,
	}
}

// raw JMA response shape (only fields we use)
type jmaArea struct {
	Area     struct{ Name, Code string } `json:"area"`
	Weathers []string                    `json:"weathers"`
	Temps    []string                    `json:"temps"`
	TempsMin []string                    `json:"tempsMin"`
	TempsMax []string                    `json:"tempsMax"`
}
type jmaSeries struct {
	TimeDefines []string  `json:"timeDefines"`
	Areas       []jmaArea `json:"areas"`
}
type jmaForecast struct {
	TimeSeries []jmaSeries `json:"timeSeries"`
}

func (c *Client) Fetch(ctx context.Context, officeCode string) (*Snapshot, error) {
	url := fmt.Sprintf("%s/%s.json", c.BaseURL, officeCode)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("jma get: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("jma status %d", resp.StatusCode)
	}
	var forecasts []jmaForecast
	if err := json.NewDecoder(resp.Body).Decode(&forecasts); err != nil {
		return nil, fmt.Errorf("jma decode: %w", err)
	}
	if len(forecasts) < 1 {
		return nil, fmt.Errorf("jma: empty forecast array")
	}
	snap := &Snapshot{CityLabel: c.CityLabel, FetchedAt: time.Now().UTC().Format(time.RFC3339)}

	// First forecast block carries weathers + temps.
	for _, ts := range forecasts[0].TimeSeries {
		if len(ts.Areas) == 0 {
			continue
		}
		a := ts.Areas[0]
		if len(a.Weathers) > 0 && snap.CurrentCondition == "" {
			snap.CurrentCondition = a.Weathers[0]
			if len(a.Weathers) > 1 {
				snap.ForecastCondition = a.Weathers[1]
			} else {
				snap.ForecastCondition = a.Weathers[0]
			}
		}
		if len(a.Temps) > 0 && snap.CurrentTempC == nil {
			if n, ok := parseTemp(a.Temps[0]); ok {
				snap.CurrentTempC = &n
			}
		}
	}

	// Second forecast block typically carries tempsMin/tempsMax for next day.
	if len(forecasts) >= 2 {
		for _, ts := range forecasts[1].TimeSeries {
			if len(ts.Areas) == 0 {
				continue
			}
			a := ts.Areas[0]
			if n, ok := lastNonEmptyTemp(a.TempsMax); ok {
				snap.ForecastHighC = &n
			}
			if n, ok := lastNonEmptyTemp(a.TempsMin); ok {
				snap.ForecastLowC = &n
			}
		}
	}

	return snap, nil
}

func parseTemp(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return n, true
}

func lastNonEmptyTemp(ss []string) (int, bool) {
	for i := len(ss) - 1; i >= 0; i-- {
		if n, ok := parseTemp(ss[i]); ok {
			return n, true
		}
	}
	return 0, false
}
