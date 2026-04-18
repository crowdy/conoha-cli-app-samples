package config

import (
	"testing"

	"github.com/spf13/viper"
)

func TestRequireFields_MissingChannelID(t *testing.T) {
	viper.Reset()
	viper.Set("base_url", "http://localhost:3000")
	viper.Set("channel_secret", "secret")
	err := RequireTokenFields()
	if err == nil {
		t.Fatal("expected error for missing channel_id")
	}
}

func TestRequireFields_AllPresent(t *testing.T) {
	viper.Reset()
	viper.Set("base_url", "http://localhost:3000")
	viper.Set("channel_id", "123")
	viper.Set("channel_secret", "secret")
	err := RequireTokenFields()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRequireAccessToken_Missing(t *testing.T) {
	viper.Reset()
	err := RequireAccessToken()
	if err == nil {
		t.Fatal("expected error for missing access_token")
	}
}

func TestRequireAccessToken_Present(t *testing.T) {
	viper.Reset()
	viper.Set("access_token", "tok_abc")
	err := RequireAccessToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
