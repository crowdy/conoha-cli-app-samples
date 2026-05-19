package config

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type GoogleAccount struct {
	Label        string `json:"label"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	RefreshToken string `json:"refresh_token"`
}

type Shortcut struct {
	Label string `json:"label"`
	Icon  string `json:"icon"`
	URL   string `json:"url"`
}

type Config struct {
	Port          string
	DBPath        string
	JMAOfficeCode string
	JMACityLabel  string

	MSTenantID     string
	MSClientID     string
	MSClientSecret string
	MSRefreshToken string

	GoogleAccounts []GoogleAccount
	Shortcuts      []Shortcut

	BrandName string

	ScheduleTTL time.Duration
	WeatherTTL  time.Duration
}

func Load() (*Config, error) {
	// Best-effort .env load; absence is fine.
	_ = godotenv.Load()

	cfg := &Config{
		Port:           getenv("PORT", "8080"),
		DBPath:         os.Getenv("DB_PATH"),
		JMAOfficeCode:  os.Getenv("JMA_OFFICE_CODE"),
		JMACityLabel:   os.Getenv("JMA_CITY_LABEL"),
		MSTenantID:     os.Getenv("MS_TENANT_ID"),
		MSClientID:     os.Getenv("MS_CLIENT_ID"),
		MSClientSecret: os.Getenv("MS_CLIENT_SECRET"),
		MSRefreshToken: os.Getenv("MS_REFRESH_TOKEN"),
		BrandName:      getenv("BRAND_NAME", "My Company"),
	}

	required := map[string]string{
		"DB_PATH":         cfg.DBPath,
		"JMA_OFFICE_CODE": cfg.JMAOfficeCode,
		"JMA_CITY_LABEL":  cfg.JMACityLabel,
	}
	// MS_* keys are optional as a group; if MS_TENANT_ID is set, the rest
	// must also be set. If any non-tenant MS_* key is set without
	// MS_TENANT_ID, that's a configuration mistake.
	if cfg.MSTenantID != "" {
		required["MS_CLIENT_ID"] = cfg.MSClientID
		required["MS_CLIENT_SECRET"] = cfg.MSClientSecret
		required["MS_REFRESH_TOKEN"] = cfg.MSRefreshToken
	} else if cfg.MSClientID != "" || cfg.MSClientSecret != "" || cfg.MSRefreshToken != "" {
		return nil, fmt.Errorf("MS_TENANT_ID required when any other MS_* key is set")
	}
	var missing []string
	for k, v := range required {
		if v == "" {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required env keys: %v", missing)
	}

	gaRaw := getenv("GOOGLE_ACCOUNTS", "[]")
	if err := json.Unmarshal([]byte(gaRaw), &cfg.GoogleAccounts); err != nil {
		return nil, fmt.Errorf("GOOGLE_ACCOUNTS JSON parse: %w", err)
	}
	scRaw := getenv("SHORTCUTS", "[]")
	if err := json.Unmarshal([]byte(scRaw), &cfg.Shortcuts); err != nil {
		return nil, fmt.Errorf("SHORTCUTS JSON parse: %w", err)
	}

	cfg.ScheduleTTL = parseSeconds("SCHEDULE_TTL_SECONDS", 300)
	cfg.WeatherTTL = parseSeconds("WEATHER_TTL_SECONDS", 1800)
	return cfg, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func parseSeconds(k string, def int) time.Duration {
	v := os.Getenv(k)
	if v == "" {
		return time.Duration(def) * time.Second
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return time.Duration(def) * time.Second
	}
	return time.Duration(n) * time.Second
}
