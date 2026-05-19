package config

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad_MissingRequiredKey(t *testing.T) {
	// Unconditionally required keys (MS_* are conditionally required and tested separately).
	required := []string{
		"DB_PATH",
		"JMA_OFFICE_CODE",
		"JMA_CITY_LABEL",
	}
	for _, missing := range required {
		t.Run(missing, func(t *testing.T) {
			t.Setenv("DB_PATH", "x")
			t.Setenv("JMA_OFFICE_CODE", "130000")
			t.Setenv("JMA_CITY_LABEL", "渋谷区")
			t.Setenv("MS_TENANT_ID", "t")
			t.Setenv("MS_CLIENT_ID", "c")
			t.Setenv("MS_CLIENT_SECRET", "s")
			t.Setenv("MS_REFRESH_TOKEN", "r")
			t.Setenv("GOOGLE_ACCOUNTS", "[]")
			t.Setenv("SHORTCUTS", "[]")
			t.Setenv(missing, "")
			_, err := Load()
			if err == nil {
				t.Fatalf("expected error when %s is empty", missing)
			}
			if !strings.Contains(err.Error(), missing) {
				t.Errorf("error %q does not mention %q", err.Error(), missing)
			}
		})
	}
}

func TestLoad_MSOutlookOptional(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DB_PATH", filepath.Join(dir, "db.sqlite"))
	t.Setenv("JMA_OFFICE_CODE", "130000")
	t.Setenv("JMA_CITY_LABEL", "渋谷区")
	t.Setenv("MS_TENANT_ID", "")
	t.Setenv("MS_CLIENT_ID", "")
	t.Setenv("MS_CLIENT_SECRET", "")
	t.Setenv("MS_REFRESH_TOKEN", "")
	t.Setenv("GOOGLE_ACCOUNTS", "[]")
	t.Setenv("SHORTCUTS", "[]")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.MSTenantID != "" {
		t.Errorf("MSTenantID expected empty, got %q", cfg.MSTenantID)
	}
}

func TestLoad_MSPartialConfig(t *testing.T) {
	t.Setenv("DB_PATH", "x")
	t.Setenv("JMA_OFFICE_CODE", "130000")
	t.Setenv("JMA_CITY_LABEL", "渋谷区")
	t.Setenv("MS_TENANT_ID", "")
	t.Setenv("MS_CLIENT_ID", "c")
	t.Setenv("MS_CLIENT_SECRET", "")
	t.Setenv("MS_REFRESH_TOKEN", "")
	t.Setenv("GOOGLE_ACCOUNTS", "[]")
	t.Setenv("SHORTCUTS", "[]")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when MS_CLIENT_ID is set without MS_TENANT_ID")
	}
	if !strings.Contains(err.Error(), "MS_TENANT_ID") {
		t.Errorf("error %q does not mention MS_TENANT_ID", err.Error())
	}
}

func TestLoad_MSAllSetMissingClientID(t *testing.T) {
	t.Setenv("DB_PATH", "x")
	t.Setenv("JMA_OFFICE_CODE", "130000")
	t.Setenv("JMA_CITY_LABEL", "渋谷区")
	t.Setenv("MS_TENANT_ID", "t")
	t.Setenv("MS_CLIENT_ID", "")
	t.Setenv("MS_CLIENT_SECRET", "s")
	t.Setenv("MS_REFRESH_TOKEN", "r")
	t.Setenv("GOOGLE_ACCOUNTS", "[]")
	t.Setenv("SHORTCUTS", "[]")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when MS_CLIENT_ID is empty but MS_TENANT_ID is set")
	}
	if !strings.Contains(err.Error(), "MS_CLIENT_ID") {
		t.Errorf("error %q does not mention MS_CLIENT_ID", err.Error())
	}
}

func TestLoad_Defaults(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DB_PATH", filepath.Join(dir, "db.sqlite"))
	t.Setenv("PORT", "")
	t.Setenv("JMA_OFFICE_CODE", "130000")
	t.Setenv("JMA_CITY_LABEL", "渋谷区")
	t.Setenv("MS_TENANT_ID", "t")
	t.Setenv("MS_CLIENT_ID", "c")
	t.Setenv("MS_CLIENT_SECRET", "s")
	t.Setenv("MS_REFRESH_TOKEN", "r")
	t.Setenv("GOOGLE_ACCOUNTS", "[]")
	t.Setenv("SHORTCUTS", "[]")
	t.Setenv("SCHEDULE_TTL_SECONDS", "")
	t.Setenv("WEATHER_TTL_SECONDS", "")
	t.Setenv("BRAND_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port default: got %q", cfg.Port)
	}
	if cfg.ScheduleTTL.Seconds() != 300 {
		t.Errorf("ScheduleTTL default: got %v", cfg.ScheduleTTL)
	}
	if cfg.WeatherTTL.Seconds() != 1800 {
		t.Errorf("WeatherTTL default: got %v", cfg.WeatherTTL)
	}
	if cfg.BrandName != "My Company" {
		t.Errorf("BrandName default: got %q, want %q", cfg.BrandName, "My Company")
	}
}

func TestLoad_BrandNameExplicit(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DB_PATH", filepath.Join(dir, "db.sqlite"))
	t.Setenv("JMA_OFFICE_CODE", "130000")
	t.Setenv("JMA_CITY_LABEL", "渋谷区")
	t.Setenv("MS_TENANT_ID", "t")
	t.Setenv("MS_CLIENT_ID", "c")
	t.Setenv("MS_CLIENT_SECRET", "s")
	t.Setenv("MS_REFRESH_TOKEN", "r")
	t.Setenv("GOOGLE_ACCOUNTS", "[]")
	t.Setenv("SHORTCUTS", "[]")
	t.Setenv("BRAND_NAME", "GMO INTERNET GROUP")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.BrandName != "GMO INTERNET GROUP" {
		t.Errorf("BrandName explicit: got %q, want %q", cfg.BrandName, "GMO INTERNET GROUP")
	}
}

func TestLoad_BadGoogleAccountsJSON(t *testing.T) {
	t.Setenv("DB_PATH", "x")
	t.Setenv("JMA_OFFICE_CODE", "130000")
	t.Setenv("JMA_CITY_LABEL", "渋谷区")
	t.Setenv("MS_TENANT_ID", "t")
	t.Setenv("MS_CLIENT_ID", "c")
	t.Setenv("MS_CLIENT_SECRET", "s")
	t.Setenv("MS_REFRESH_TOKEN", "r")
	t.Setenv("GOOGLE_ACCOUNTS", "not-json")
	t.Setenv("SHORTCUTS", "[]")
	_, err := Load()
	if err == nil {
		t.Fatal("expected JSON parse error")
	}
}

func TestLoad_ParsesAccountsAndShortcuts(t *testing.T) {
	t.Setenv("DB_PATH", "x")
	t.Setenv("JMA_OFFICE_CODE", "130000")
	t.Setenv("JMA_CITY_LABEL", "渋谷区")
	t.Setenv("MS_TENANT_ID", "t")
	t.Setenv("MS_CLIENT_ID", "c")
	t.Setenv("MS_CLIENT_SECRET", "s")
	t.Setenv("MS_REFRESH_TOKEN", "r")
	t.Setenv("GOOGLE_ACCOUNTS", `[{"label":"a","client_id":"x","client_secret":"y","refresh_token":"z"}]`)
	t.Setenv("SHORTCUTS", `[{"label":"S","icon":"/i.png","url":"http://x"}]`)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.GoogleAccounts) != 1 || cfg.GoogleAccounts[0].Label != "a" {
		t.Errorf("GoogleAccounts not parsed: %+v", cfg.GoogleAccounts)
	}
	if len(cfg.Shortcuts) != 1 || cfg.Shortcuts[0].URL != "http://x" {
		t.Errorf("Shortcuts not parsed: %+v", cfg.Shortcuts)
	}
}
