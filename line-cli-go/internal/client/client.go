package client

import (
	"line-cli-go/internal/config"

	"github.com/line/line-bot-sdk-go/v8/linebot/channel_access_token"
	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
)

func NewMessagingAPI() (*messaging_api.MessagingApiAPI, error) {
	if err := config.RequireAccessToken(); err != nil {
		return nil, err
	}
	client, err := messaging_api.NewMessagingApiAPI(
		config.AccessToken(),
		messaging_api.WithEndpoint(config.BaseURL()),
	)
	return client, err
}

func NewMessagingBlobAPI() (*messaging_api.MessagingApiBlobAPI, error) {
	if err := config.RequireAccessToken(); err != nil {
		return nil, err
	}
	client, err := messaging_api.NewMessagingApiBlobAPI(
		config.AccessToken(),
		messaging_api.WithBlobEndpoint(config.BaseURL()),
	)
	return client, err
}

func NewChannelAccessTokenAPI() (*channel_access_token.ChannelAccessTokenAPI, error) {
	client, err := channel_access_token.NewChannelAccessTokenAPI(
		channel_access_token.WithEndpoint(config.BaseURL()),
	)
	return client, err
}
