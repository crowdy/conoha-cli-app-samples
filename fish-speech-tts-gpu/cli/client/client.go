package client

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"
)

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		BaseURL:    baseURL,
		HTTPClient: &http.Client{Timeout: 300 * time.Second},
	}
}

// Health checks the server status.
func (c *Client) Health() error {
	resp, err := c.HTTPClient.Get(c.BaseURL + "/v1/health")
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check returned status %d", resp.StatusCode)
	}
	return nil
}

// TTSRequest is the request body for POST /v1/tts.
type TTSRequest struct {
	Text              string           `json:"text"`
	ChunkLength       int              `json:"chunk_length,omitempty"`
	Format            string           `json:"format,omitempty"`
	Latency           string           `json:"latency,omitempty"`
	References        []ReferenceAudio `json:"references,omitempty"`
	ReferenceID       string           `json:"reference_id,omitempty"`
	Seed              *int             `json:"seed,omitempty"`
	UseMemoryCache    string           `json:"use_memory_cache,omitempty"`
	Normalize         *bool            `json:"normalize,omitempty"`
	Streaming         bool             `json:"streaming,omitempty"`
	MaxNewTokens      int              `json:"max_new_tokens,omitempty"`
	TopP              float64          `json:"top_p,omitempty"`
	RepetitionPenalty float64          `json:"repetition_penalty,omitempty"`
	Temperature       float64          `json:"temperature,omitempty"`
}

type ReferenceAudio struct {
	Audio string `json:"audio"` // base64-encoded audio bytes
	Text  string `json:"text"`
}

// TTS sends a text-to-speech request and returns raw audio bytes.
func (c *Client) TTS(req TTSRequest) ([]byte, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, c.BaseURL+"/v1/tts", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("tts request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("tts returned status %d: %s", resp.StatusCode, string(errBody))
	}

	return io.ReadAll(resp.Body)
}

// EncodeRequest is the request body for POST /v1/vqgan/encode.
type EncodeRequest struct {
	Audios []string `json:"audios"` // base64-encoded audio bytes
}

// EncodeResponse is the response from POST /v1/vqgan/encode.
type EncodeResponse struct {
	Tokens [][][]int `json:"tokens"`
}

// Encode converts audio to VQ tokens.
func (c *Client) Encode(audioData []byte) (*EncodeResponse, error) {
	req := EncodeRequest{
		Audios: []string{base64.StdEncoding.EncodeToString(audioData)},
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, c.BaseURL+"/v1/vqgan/encode", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("encode request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("encode returned status %d: %s", resp.StatusCode, string(errBody))
	}

	var result EncodeResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// DecodeRequest is the request body for POST /v1/vqgan/decode.
type DecodeRequest struct {
	Tokens [][][]int `json:"tokens"`
}

// DecodeResponse is the response from POST /v1/vqgan/decode.
type DecodeResponse struct {
	Audios []string `json:"audios"` // base64-encoded audio bytes
}

// Decode converts VQ tokens back to audio.
func (c *Client) Decode(tokens [][][]int) (*DecodeResponse, error) {
	req := DecodeRequest{Tokens: tokens}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, c.BaseURL+"/v1/vqgan/decode", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("decode request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("decode returned status %d: %s", resp.StatusCode, string(errBody))
	}

	var result DecodeResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// ListRefsResponse is the response from GET /v1/references/list.
type ListRefsResponse struct {
	Success      bool     `json:"success"`
	ReferenceIDs []string `json:"reference_ids"`
	Message      string   `json:"message"`
}

// ListRefs returns all stored reference voices.
func (c *Client) ListRefs() (*ListRefsResponse, error) {
	resp, err := c.HTTPClient.Get(c.BaseURL + "/v1/references/list")
	if err != nil {
		return nil, fmt.Errorf("list refs failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list refs returned status %d: %s", resp.StatusCode, string(errBody))
	}

	var result ListRefsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// AddRefResponse is the response from POST /v1/references/add.
type AddRefResponse struct {
	Success     bool   `json:"success"`
	Message     string `json:"message"`
	ReferenceID string `json:"reference_id"`
}

// AddRef uploads a reference voice via multipart form.
func (c *Client) AddRef(name, text string, audio io.Reader, filename string) (*AddRefResponse, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	if err := writer.WriteField("id", name); err != nil {
		return nil, fmt.Errorf("write id field: %w", err)
	}
	if err := writer.WriteField("text", text); err != nil {
		return nil, fmt.Errorf("write text field: %w", err)
	}

	part, err := writer.CreateFormFile("audio", filename)
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, audio); err != nil {
		return nil, fmt.Errorf("copy audio: %w", err)
	}
	writer.Close()

	httpReq, err := http.NewRequest(http.MethodPost, c.BaseURL+"/v1/references/add", body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("add ref failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("add ref returned status %d: %s", resp.StatusCode, string(errBody))
	}

	var result AddRefResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// DeleteRefResponse is the response from DELETE /v1/references/delete.
type DeleteRefResponse struct {
	Success     bool   `json:"success"`
	Message     string `json:"message"`
	ReferenceID string `json:"reference_id"`
}

// DeleteRef removes a stored reference voice.
func (c *Client) DeleteRef(name string) (*DeleteRefResponse, error) {
	body, err := json.Marshal(map[string]string{"reference_id": name})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodDelete, c.BaseURL+"/v1/references/delete", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("delete ref failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("delete ref returned status %d: %s", resp.StatusCode, string(errBody))
	}

	var result DeleteRefResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// UpdateRefResponse is the response from POST /v1/references/update.
type UpdateRefResponse struct {
	Success        bool   `json:"success"`
	Message        string `json:"message"`
	OldReferenceID string `json:"old_reference_id"`
	NewReferenceID string `json:"new_reference_id"`
}

// UpdateRef renames a stored reference voice.
func (c *Client) UpdateRef(oldName, newName string) (*UpdateRefResponse, error) {
	body, err := json.Marshal(map[string]string{
		"old_reference_id": oldName,
		"new_reference_id": newName,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, c.BaseURL+"/v1/references/update", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("update ref failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("update ref returned status %d: %s", resp.StatusCode, string(errBody))
	}

	var result UpdateRefResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}
