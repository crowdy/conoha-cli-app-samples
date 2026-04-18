package client

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"line-cli-go/internal/config"

	"github.com/line/line-bot-sdk-go/v8/linebot/channel_access_token"
	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
)

// nullStripTransport wraps an http.RoundTripper and removes null-valued fields
// from JSON request bodies. The LINE SDK serializes optional array/object fields
// as null, which strict OpenAPI validators (like line-api-mock's AJV) reject.
type nullStripTransport struct {
	base http.RoundTripper
}

func (t *nullStripTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Body != nil && strings.Contains(req.Header.Get("Content-Type"), "application/json") {
		body, err := io.ReadAll(req.Body)
		req.Body.Close()
		if err != nil {
			return nil, err
		}
		var data map[string]any
		if json.Unmarshal(body, &data) == nil {
			stripNulls(data)
			cleaned, _ := json.Marshal(data)
			req.Body = io.NopCloser(bytes.NewReader(cleaned))
			req.ContentLength = int64(len(cleaned))
		} else {
			req.Body = io.NopCloser(bytes.NewReader(body))
		}
	}
	return t.base.RoundTrip(req)
}

func stripNulls(m map[string]any) {
	for k, v := range m {
		if v == nil {
			delete(m, k)
		} else if sub, ok := v.(map[string]any); ok {
			stripNulls(sub)
		}
	}
}

func httpClient() *http.Client {
	return &http.Client{
		Transport: &nullStripTransport{base: http.DefaultTransport},
	}
}

func NewMessagingAPI() (*messaging_api.MessagingApiAPI, error) {
	if err := config.RequireAccessToken(); err != nil {
		return nil, err
	}
	client, err := messaging_api.NewMessagingApiAPI(
		config.AccessToken(),
		messaging_api.WithEndpoint(config.BaseURL()),
		messaging_api.WithHTTPClient(httpClient()),
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
