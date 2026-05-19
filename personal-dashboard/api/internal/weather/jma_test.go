package weather

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestFetch_ParsesFixture(t *testing.T) {
	fixture, err := os.ReadFile("../../testdata/jma_130000.json")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(fixture)
	}))
	defer srv.Close()

	c := &Client{BaseURL: srv.URL, HTTP: srv.Client(), CityLabel: "渋谷区"}
	got, err := c.Fetch(context.Background(), "130000")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if got.CityLabel != "渋谷区" {
		t.Errorf("CityLabel: %q", got.CityLabel)
	}
	if got.CurrentCondition == "" {
		t.Error("CurrentCondition empty")
	}
	if got.CurrentTempC == nil {
		t.Error("CurrentTempC nil")
	}
	if got.ForecastHighC == nil || got.ForecastLowC == nil {
		t.Errorf("forecast high/low nil: hi=%v lo=%v", got.ForecastHighC, got.ForecastLowC)
	}
	if got.ForecastCondition == "" {
		t.Error("ForecastCondition empty")
	}
}

func TestFetch_NetworkError(t *testing.T) {
	c := &Client{BaseURL: "http://127.0.0.1:1", HTTP: http.DefaultClient, CityLabel: "x"}
	_, err := c.Fetch(context.Background(), "130000")
	if err == nil {
		t.Fatal("expected error")
	}
}
