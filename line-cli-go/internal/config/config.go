package config

import (
	"fmt"

	"github.com/spf13/viper"
)

func BaseURL() string {
	return viper.GetString("base_url")
}

func ChannelID() string {
	return viper.GetString("channel_id")
}

func ChannelSecret() string {
	return viper.GetString("channel_secret")
}

func AccessToken() string {
	return viper.GetString("access_token")
}

func JSONMode() bool {
	return viper.GetBool("json")
}

// RequireTokenFields validates that channel_id and channel_secret are set (needed for OAuth).
func RequireTokenFields() error {
	if ChannelID() == "" {
		return fmt.Errorf("channel_id is required (set LINE_CHANNEL_ID, config file, or --channel-id)")
	}
	if ChannelSecret() == "" {
		return fmt.Errorf("channel_secret is required (set LINE_CHANNEL_SECRET, config file, or --channel-secret)")
	}
	return nil
}

// RequireAccessToken validates that access_token is set (needed for API calls).
func RequireAccessToken() error {
	if AccessToken() == "" {
		return fmt.Errorf("access_token is required (set LINE_ACCESS_TOKEN, config file, or --access-token)")
	}
	return nil
}
