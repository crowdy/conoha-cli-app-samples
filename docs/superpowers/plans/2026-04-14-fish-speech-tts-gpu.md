# Fish Speech TTS GPU Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Fish Speech TTS with WebUI and API server on ConoHa L4 GPU, plus a Go CLI client that calls the API and plays audio.

**Architecture:** Single container using `fishaudio/fish-speech:latest-webui-cuda` with a custom entrypoint that downloads the model (if missing), starts the API server (`tools/api_server.py` on port 8080) in the background, then starts the Gradio WebUI (`tools/run_webui.py` on port 7860) in the foreground. A Go CLI in `cli/` talks to the API server via HTTP.

**Tech Stack:** Docker (GPU passthrough), Fish Speech (Python TTS), Go 1.23+ (cobra CLI, oto/v3 audio playback)

---

## File Structure

```
fish-speech-tts-gpu/
├── compose.yml              # Docker Compose with GPU reservation
├── entrypoint.sh            # Model download + start API server + WebUI
├── .dockerignore             # Exclude cli/, .git, *.sh from Docker context
├── cli/
│   ├── main.go              # Cobra root command with --server flag
│   ├── cmd/
│   │   ├── tts.go           # tts subcommand
│   │   ├── health.go        # health subcommand
│   │   ├── ref.go           # ref add/list/delete/update subcommands
│   │   ├── encode.go        # encode subcommand
│   │   └── decode.go        # decode subcommand
│   ├── client/
│   │   ├── client.go        # HTTP client for Fish Speech API
│   │   └── client_test.go   # Tests with httptest
│   ├── audio/
│   │   ├── player.go        # WAV parsing + oto playback
│   │   └── player_test.go   # WAV header parsing tests
│   ├── go.mod
│   ├── go.sum
│   └── Makefile
└── README.md                # Japanese deployment guide
```

---

### Task 1: Docker Infrastructure

**Files:**
- Create: `fish-speech-tts-gpu/compose.yml`
- Create: `fish-speech-tts-gpu/entrypoint.sh`
- Create: `fish-speech-tts-gpu/.dockerignore`

- [ ] **Step 1: Create directory**

```bash
mkdir -p fish-speech-tts-gpu
```

- [ ] **Step 2: Create compose.yml**

Create `fish-speech-tts-gpu/compose.yml`:

```yaml
services:
  fish-speech:
    image: fishaudio/fish-speech:latest-webui-cuda
    entrypoint: ["/bin/bash", "/app/custom-entrypoint.sh"]
    ports:
      - "7860:7860"
      - "8080:8080"
    volumes:
      - ./entrypoint.sh:/app/custom-entrypoint.sh:ro
      - model_data:/app/checkpoints
      - references:/app/references
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    environment:
      - COMPILE=1
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 20
      start_period: 600s
    restart: unless-stopped

volumes:
  model_data:
  references:
```

- [ ] **Step 3: Create entrypoint.sh**

Create `fish-speech-tts-gpu/entrypoint.sh`:

```bash
#!/bin/bash
set -e

MODEL_DIR="/app/checkpoints/s2-pro"
MARKER_FILE="$MODEL_DIR/codec.pth"

# Download model only if not already present
if [ ! -f "$MARKER_FILE" ]; then
    echo "=== Downloading Fish Speech s2-pro model ==="
    huggingface-cli download fishaudio/s2-pro --local-dir "$MODEL_DIR"
    echo "=== Model download complete ==="
else
    echo "=== Model already exists, skipping download ==="
fi

# Start API server in background
echo "=== Starting API server on port 8080 ==="
python tools/api_server.py \
    --listen 0.0.0.0:8080 \
    --llama-checkpoint-path "$MODEL_DIR" \
    --decoder-checkpoint-path "$MODEL_DIR/codec.pth" \
    --decoder-config-name modded_dac_vq \
    --device cuda \
    ${COMPILE:+--compile} &

# Start WebUI in foreground
echo "=== Starting WebUI on port 7860 ==="
exec python tools/run_webui.py
```

- [ ] **Step 4: Create .dockerignore**

Create `fish-speech-tts-gpu/.dockerignore`:

```
.git
cli/
*.md
```

- [ ] **Step 5: Commit**

```bash
git add fish-speech-tts-gpu/compose.yml fish-speech-tts-gpu/entrypoint.sh fish-speech-tts-gpu/.dockerignore
git commit -m "feat(fish-speech-tts-gpu): add Docker infrastructure"
```

---

### Task 2: Go Module and Root Command

**Files:**
- Create: `fish-speech-tts-gpu/cli/go.mod`
- Create: `fish-speech-tts-gpu/cli/main.go`

- [ ] **Step 1: Initialize Go module**

```bash
cd fish-speech-tts-gpu/cli
go mod init fish-speech-cli
```

- [ ] **Step 2: Create main.go**

Create `fish-speech-tts-gpu/cli/main.go`:

```go
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var serverURL string

var rootCmd = &cobra.Command{
	Use:   "fish-speech-cli",
	Short: "CLI client for Fish Speech TTS API",
}

func init() {
	rootCmd.PersistentFlags().StringVar(&serverURL, "server", "http://localhost:8080", "Fish Speech API server URL")
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

- [ ] **Step 3: Install cobra dependency**

```bash
cd fish-speech-tts-gpu/cli
go get github.com/spf13/cobra
```

- [ ] **Step 4: Verify it compiles**

```bash
cd fish-speech-tts-gpu/cli
go build -o fish-speech-cli .
./fish-speech-cli --help
```

Expected: Help text showing `fish-speech-cli` with `--server` flag.

- [ ] **Step 5: Commit**

```bash
git add fish-speech-tts-gpu/cli/go.mod fish-speech-tts-gpu/cli/go.sum fish-speech-tts-gpu/cli/main.go
git commit -m "feat(fish-speech-tts-gpu): scaffold Go CLI with cobra root command"
```

---

### Task 3: API Client Package - Health and TTS

**Files:**
- Create: `fish-speech-tts-gpu/cli/client/client.go`
- Create: `fish-speech-tts-gpu/cli/client/client_test.go`

- [ ] **Step 1: Write failing tests**

Create `fish-speech-tts-gpu/cli/client/client_test.go`:

```go
package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/v1/health" {
			t.Errorf("expected /v1/health, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
	defer srv.Close()

	c := New(srv.URL)
	err := c.Health()
	if err != nil {
		t.Fatalf("Health() error: %v", err)
	}
}

func TestHealth_ServerDown(t *testing.T) {
	c := New("http://localhost:1") // unreachable
	err := c.Health()
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestTTS(t *testing.T) {
	wavHeader := []byte("RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/tts" {
			t.Errorf("expected /v1/tts, got %s", r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected application/json, got %s", ct)
		}

		var req TTSRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Text != "hello" {
			t.Errorf("expected text 'hello', got '%s'", req.Text)
		}
		if req.Format != "wav" {
			t.Errorf("expected format 'wav', got '%s'", req.Format)
		}

		w.Header().Set("Content-Type", "audio/wav")
		w.Write(wavHeader)
	}))
	defer srv.Close()

	c := New(srv.URL)
	data, err := c.TTS(TTSRequest{Text: "hello", Format: "wav"})
	if err != nil {
		t.Fatalf("TTS() error: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("expected non-empty audio data")
	}
	if string(data[:4]) != "RIFF" {
		t.Error("expected WAV RIFF header")
	}
}

func TestTTS_WithReference(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req TTSRequest
		json.NewDecoder(r.Body).Decode(&req)
		if req.ReferenceID != "my-voice" {
			t.Errorf("expected reference_id 'my-voice', got '%s'", req.ReferenceID)
		}
		w.Header().Set("Content-Type", "audio/wav")
		w.Write([]byte("RIFF"))
	}))
	defer srv.Close()

	c := New(srv.URL)
	_, err := c.TTS(TTSRequest{Text: "test", Format: "wav", ReferenceID: "my-voice"})
	if err != nil {
		t.Fatalf("TTS() error: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd fish-speech-tts-gpu/cli
go test ./client/ -v
```

Expected: compilation error — `client` package doesn't exist yet.

- [ ] **Step 3: Implement client package**

Create `fish-speech-tts-gpu/cli/client/client.go`:

```go
package client

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
)

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		BaseURL:    baseURL,
		HTTPClient: &http.Client{},
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

// Reference represents a stored reference voice.
type Reference struct {
	ID string `json:"reference_id"`
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
	body, _ := json.Marshal(map[string]string{"reference_id": name})

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
	body, _ := json.Marshal(map[string]string{
		"old_reference_id": oldName,
		"new_reference_id": newName,
	})

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd fish-speech-tts-gpu/cli
go test ./client/ -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add fish-speech-tts-gpu/cli/client/
git commit -m "feat(fish-speech-tts-gpu): add API client with health, TTS, refs, encode/decode"
```

---

### Task 4: WAV Audio Player

**Files:**
- Create: `fish-speech-tts-gpu/cli/audio/player.go`
- Create: `fish-speech-tts-gpu/cli/audio/player_test.go`

- [ ] **Step 1: Write failing tests**

Create `fish-speech-tts-gpu/cli/audio/player_test.go`:

```go
package audio

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func buildTestWAV(sampleRate uint32, channels uint16, bitsPerSample uint16, pcmData []byte) []byte {
	buf := &bytes.Buffer{}
	dataSize := uint32(len(pcmData))
	fileSize := 36 + dataSize

	// RIFF header
	buf.WriteString("RIFF")
	binary.Write(buf, binary.LittleEndian, fileSize)
	buf.WriteString("WAVE")

	// fmt subchunk
	buf.WriteString("fmt ")
	binary.Write(buf, binary.LittleEndian, uint32(16)) // subchunk size
	binary.Write(buf, binary.LittleEndian, uint16(1))  // PCM format
	binary.Write(buf, binary.LittleEndian, channels)
	binary.Write(buf, binary.LittleEndian, sampleRate)
	byteRate := sampleRate * uint32(channels) * uint32(bitsPerSample) / 8
	binary.Write(buf, binary.LittleEndian, byteRate)
	blockAlign := channels * bitsPerSample / 8
	binary.Write(buf, binary.LittleEndian, blockAlign)
	binary.Write(buf, binary.LittleEndian, bitsPerSample)

	// data subchunk
	buf.WriteString("data")
	binary.Write(buf, binary.LittleEndian, dataSize)
	buf.Write(pcmData)

	return buf.Bytes()
}

func TestParseWAV_Valid(t *testing.T) {
	pcm := make([]byte, 100)
	wav := buildTestWAV(44100, 1, 16, pcm)

	header, pcmReader, err := ParseWAV(bytes.NewReader(wav))
	if err != nil {
		t.Fatalf("ParseWAV() error: %v", err)
	}
	if header.SampleRate != 44100 {
		t.Errorf("SampleRate = %d, want 44100", header.SampleRate)
	}
	if header.Channels != 1 {
		t.Errorf("Channels = %d, want 1", header.Channels)
	}
	if header.BitsPerSample != 16 {
		t.Errorf("BitsPerSample = %d, want 16", header.BitsPerSample)
	}

	data := make([]byte, 200)
	n, _ := pcmReader.Read(data)
	if n != 100 {
		t.Errorf("PCM data length = %d, want 100", n)
	}
}

func TestParseWAV_Stereo48k(t *testing.T) {
	pcm := make([]byte, 200)
	wav := buildTestWAV(48000, 2, 16, pcm)

	header, _, err := ParseWAV(bytes.NewReader(wav))
	if err != nil {
		t.Fatalf("ParseWAV() error: %v", err)
	}
	if header.SampleRate != 48000 {
		t.Errorf("SampleRate = %d, want 48000", header.SampleRate)
	}
	if header.Channels != 2 {
		t.Errorf("Channels = %d, want 2", header.Channels)
	}
}

func TestParseWAV_InvalidHeader(t *testing.T) {
	_, _, err := ParseWAV(bytes.NewReader([]byte("not a wav file")))
	if err == nil {
		t.Fatal("expected error for invalid WAV")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd fish-speech-tts-gpu/cli
go test ./audio/ -v
```

Expected: compilation error — `audio` package doesn't exist yet.

- [ ] **Step 3: Implement audio player**

Create `fish-speech-tts-gpu/cli/audio/player.go`:

```go
package audio

import (
	"encoding/binary"
	"fmt"
	"io"
	"time"

	"github.com/ebitengine/oto/v3"
)

// WAVHeader contains parsed WAV file metadata.
type WAVHeader struct {
	SampleRate    int
	Channels      int
	BitsPerSample int
}

// ParseWAV parses a WAV file header and returns metadata plus an io.Reader for the PCM data.
func ParseWAV(r io.Reader) (*WAVHeader, io.Reader, error) {
	// Read RIFF header (12 bytes)
	var riffHeader [12]byte
	if _, err := io.ReadFull(r, riffHeader[:]); err != nil {
		return nil, nil, fmt.Errorf("read RIFF header: %w", err)
	}
	if string(riffHeader[:4]) != "RIFF" || string(riffHeader[8:12]) != "WAVE" {
		return nil, nil, fmt.Errorf("not a valid WAV file")
	}

	header := &WAVHeader{}

	// Read chunks until we find "data"
	for {
		var chunkHeader [8]byte
		if _, err := io.ReadFull(r, chunkHeader[:]); err != nil {
			return nil, nil, fmt.Errorf("read chunk header: %w", err)
		}
		chunkID := string(chunkHeader[:4])
		chunkSize := binary.LittleEndian.Uint32(chunkHeader[4:8])

		switch chunkID {
		case "fmt ":
			if chunkSize < 16 {
				return nil, nil, fmt.Errorf("fmt chunk too small: %d", chunkSize)
			}
			var fmtData [16]byte
			if _, err := io.ReadFull(r, fmtData[:]); err != nil {
				return nil, nil, fmt.Errorf("read fmt chunk: %w", err)
			}
			audioFormat := binary.LittleEndian.Uint16(fmtData[0:2])
			if audioFormat != 1 {
				return nil, nil, fmt.Errorf("unsupported audio format: %d (only PCM supported)", audioFormat)
			}
			header.Channels = int(binary.LittleEndian.Uint16(fmtData[2:4]))
			header.SampleRate = int(binary.LittleEndian.Uint32(fmtData[4:8]))
			header.BitsPerSample = int(binary.LittleEndian.Uint16(fmtData[14:16]))

			// Skip extra fmt bytes if any
			if chunkSize > 16 {
				io.CopyN(io.Discard, r, int64(chunkSize-16))
			}

		case "data":
			return header, io.LimitReader(r, int64(chunkSize)), nil

		default:
			// Skip unknown chunks
			io.CopyN(io.Discard, r, int64(chunkSize))
		}
	}
}

// Play plays WAV audio data through the system speakers.
func Play(wavData []byte) error {
	header, pcmReader, err := ParseWAV(io.Reader(readerFromBytes(wavData)))
	if err != nil {
		return fmt.Errorf("parse WAV: %w", err)
	}

	var format oto.Format
	switch header.BitsPerSample {
	case 16:
		format = oto.FormatSignedInt16LE
	case 32:
		format = oto.FormatFloat32LE
	default:
		return fmt.Errorf("unsupported bits per sample: %d", header.BitsPerSample)
	}

	ctx, readyChan, err := oto.NewContext(&oto.NewContextOptions{
		SampleRate:   header.SampleRate,
		ChannelCount: header.Channels,
		Format:       format,
	})
	if err != nil {
		return fmt.Errorf("create audio context: %w", err)
	}
	<-readyChan

	player := ctx.NewPlayer(pcmReader)
	player.Play()

	for player.IsPlaying() {
		time.Sleep(10 * time.Millisecond)
	}

	return player.Close()
}

type bytesReader struct {
	*io.SectionReader
}

func readerFromBytes(data []byte) io.Reader {
	return io.NewSectionReader(newByteReaderAt(data), 0, int64(len(data)))
}

type byteReaderAt struct {
	data []byte
}

func newByteReaderAt(data []byte) *byteReaderAt {
	return &byteReaderAt{data: data}
}

func (b *byteReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if off >= int64(len(b.data)) {
		return 0, io.EOF
	}
	n := copy(p, b.data[off:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}
```

- [ ] **Step 4: Install oto dependency and run tests**

```bash
cd fish-speech-tts-gpu/cli
go get github.com/ebitengine/oto/v3
go test ./audio/ -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add fish-speech-tts-gpu/cli/audio/
git commit -m "feat(fish-speech-tts-gpu): add WAV parser and audio player"
```

---

### Task 5: Health Command

**Files:**
- Create: `fish-speech-tts-gpu/cli/cmd/health.go`
- Modify: `fish-speech-tts-gpu/cli/main.go`

- [ ] **Step 1: Create health command**

Create `fish-speech-tts-gpu/cli/cmd/health.go`:

```go
package cmd

import (
	"fish-speech-cli/client"
	"fmt"

	"github.com/spf13/cobra"
)

func NewHealthCmd(getServer func() string) *cobra.Command {
	return &cobra.Command{
		Use:   "health",
		Short: "Check server health status",
		RunE: func(cmd *cobra.Command, args []string) error {
			c := client.New(getServer())
			if err := c.Health(); err != nil {
				return fmt.Errorf("server is not healthy: %w", err)
			}
			fmt.Println("Server is healthy")
			return nil
		},
	}
}
```

- [ ] **Step 2: Register command in main.go**

Replace `fish-speech-tts-gpu/cli/main.go` with:

```go
package main

import (
	"fish-speech-cli/cmd"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var serverURL string

var rootCmd = &cobra.Command{
	Use:   "fish-speech-cli",
	Short: "CLI client for Fish Speech TTS API",
}

func init() {
	rootCmd.PersistentFlags().StringVar(&serverURL, "server", "http://localhost:8080", "Fish Speech API server URL")

	getServer := func() string { return serverURL }

	rootCmd.AddCommand(cmd.NewHealthCmd(getServer))
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd fish-speech-tts-gpu/cli
go build -o fish-speech-cli .
./fish-speech-cli health --help
```

Expected: Help text for health command.

- [ ] **Step 4: Commit**

```bash
git add fish-speech-tts-gpu/cli/cmd/health.go fish-speech-tts-gpu/cli/main.go
git commit -m "feat(fish-speech-tts-gpu): add health command"
```

---

### Task 6: TTS Command

**Files:**
- Create: `fish-speech-tts-gpu/cli/cmd/tts.go`
- Modify: `fish-speech-tts-gpu/cli/main.go`

- [ ] **Step 1: Create TTS command**

Create `fish-speech-tts-gpu/cli/cmd/tts.go`:

```go
package cmd

import (
	"fish-speech-cli/audio"
	"fish-speech-cli/client"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func NewTTSCmd(getServer func() string) *cobra.Command {
	var (
		text        string
		output      string
		format      string
		refID       string
		play        bool
		temperature float64
		topP        float64
	)

	cmd := &cobra.Command{
		Use:   "tts",
		Short: "Convert text to speech",
		Example: `  # Play directly
  fish-speech-cli tts -t "Hello, world!"

  # Save to file
  fish-speech-cli tts -t "Hello" -o hello.wav

  # Use a reference voice
  fish-speech-cli tts -t "Hello" --ref my-voice

  # Change format
  fish-speech-cli tts -t "Hello" -o hello.mp3 --format mp3`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if text == "" {
				return fmt.Errorf("--text is required")
			}

			c := client.New(getServer())
			req := client.TTSRequest{
				Text:   text,
				Format: format,
			}
			if refID != "" {
				req.ReferenceID = refID
			}
			if cmd.Flags().Changed("temperature") {
				req.Temperature = temperature
			}
			if cmd.Flags().Changed("top-p") {
				req.TopP = topP
			}

			fmt.Fprintf(os.Stderr, "Generating speech...\n")
			data, err := c.TTS(req)
			if err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "Received %d bytes of audio\n", len(data))

			// Save to file if output specified
			if output != "" {
				if err := os.WriteFile(output, data, 0644); err != nil {
					return fmt.Errorf("write file: %w", err)
				}
				fmt.Fprintf(os.Stderr, "Saved to %s\n", output)
				if !play {
					return nil
				}
			}

			// Play audio
			if play || output == "" {
				if format != "wav" {
					return fmt.Errorf("playback only supports WAV format (got %s)", format)
				}
				fmt.Fprintf(os.Stderr, "Playing audio...\n")
				return audio.Play(data)
			}

			return nil
		},
	}

	cmd.Flags().StringVarP(&text, "text", "t", "", "Text to convert to speech (required)")
	cmd.Flags().StringVarP(&output, "output", "o", "", "Output file path (if omitted, plays directly)")
	cmd.Flags().StringVar(&format, "format", "wav", "Output format: wav, mp3, opus")
	cmd.Flags().StringVar(&refID, "ref", "", "Reference voice ID for voice cloning")
	cmd.Flags().BoolVar(&play, "play", false, "Force playback even when saving to file")
	cmd.Flags().Float64Var(&temperature, "temperature", 0.8, "Generation temperature (0.1-1.0)")
	cmd.Flags().Float64Var(&topP, "top-p", 0.8, "Top-p sampling (0.1-1.0)")

	return cmd
}
```

- [ ] **Step 2: Register TTS command in main.go**

Add to the `init()` function in `fish-speech-tts-gpu/cli/main.go`, after the health command line:

```go
	rootCmd.AddCommand(cmd.NewTTSCmd(getServer))
```

- [ ] **Step 3: Verify it compiles**

```bash
cd fish-speech-tts-gpu/cli
go build -o fish-speech-cli .
./fish-speech-cli tts --help
```

Expected: Help text showing all TTS flags.

- [ ] **Step 4: Commit**

```bash
git add fish-speech-tts-gpu/cli/cmd/tts.go fish-speech-tts-gpu/cli/main.go
git commit -m "feat(fish-speech-tts-gpu): add tts command with playback support"
```

---

### Task 7: Reference Management Commands

**Files:**
- Create: `fish-speech-tts-gpu/cli/cmd/ref.go`
- Modify: `fish-speech-tts-gpu/cli/main.go`

- [ ] **Step 1: Create ref commands**

Create `fish-speech-tts-gpu/cli/cmd/ref.go`:

```go
package cmd

import (
	"fish-speech-cli/client"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

func NewRefCmd(getServer func() string) *cobra.Command {
	refCmd := &cobra.Command{
		Use:   "ref",
		Short: "Manage reference voices",
	}

	// ref list
	refCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List all reference voices",
		RunE: func(cmd *cobra.Command, args []string) error {
			c := client.New(getServer())
			resp, err := c.ListRefs()
			if err != nil {
				return err
			}
			if len(resp.ReferenceIDs) == 0 {
				fmt.Println("No reference voices found")
				return nil
			}
			for _, id := range resp.ReferenceIDs {
				fmt.Println(id)
			}
			return nil
		},
	})

	// ref add
	var addName, addFile, addText string
	addCmd := &cobra.Command{
		Use:   "add",
		Short: "Add a reference voice",
		Example: `  fish-speech-cli ref add --name my-voice --file voice.wav --text "transcript of the audio"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if addName == "" || addFile == "" || addText == "" {
				return fmt.Errorf("--name, --file, and --text are all required")
			}

			f, err := os.Open(addFile)
			if err != nil {
				return fmt.Errorf("open audio file: %w", err)
			}
			defer f.Close()

			c := client.New(getServer())
			resp, err := c.AddRef(addName, addText, f, filepath.Base(addFile))
			if err != nil {
				return err
			}
			fmt.Printf("Added reference voice: %s\n", resp.ReferenceID)
			return nil
		},
	}
	addCmd.Flags().StringVar(&addName, "name", "", "Reference voice name (required)")
	addCmd.Flags().StringVar(&addFile, "file", "", "Audio file path (required)")
	addCmd.Flags().StringVar(&addText, "text", "", "Transcript of the audio (required)")
	refCmd.AddCommand(addCmd)

	// ref delete
	var deleteName string
	deleteCmd := &cobra.Command{
		Use:   "delete",
		Short: "Delete a reference voice",
		Example: `  fish-speech-cli ref delete --name my-voice`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if deleteName == "" {
				return fmt.Errorf("--name is required")
			}
			c := client.New(getServer())
			resp, err := c.DeleteRef(deleteName)
			if err != nil {
				return err
			}
			fmt.Printf("Deleted reference voice: %s\n", resp.ReferenceID)
			return nil
		},
	}
	deleteCmd.Flags().StringVar(&deleteName, "name", "", "Reference voice name to delete (required)")
	refCmd.AddCommand(deleteCmd)

	// ref update
	var updateOld, updateNew string
	updateCmd := &cobra.Command{
		Use:   "update",
		Short: "Rename a reference voice",
		Example: `  fish-speech-cli ref update --old my-voice --new new-voice`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if updateOld == "" || updateNew == "" {
				return fmt.Errorf("--old and --new are both required")
			}
			c := client.New(getServer())
			resp, err := c.UpdateRef(updateOld, updateNew)
			if err != nil {
				return err
			}
			fmt.Printf("Renamed reference voice: %s -> %s\n", resp.OldReferenceID, resp.NewReferenceID)
			return nil
		},
	}
	updateCmd.Flags().StringVar(&updateOld, "old", "", "Current reference voice name (required)")
	updateCmd.Flags().StringVar(&updateNew, "new", "", "New reference voice name (required)")
	refCmd.AddCommand(updateCmd)

	return refCmd
}
```

- [ ] **Step 2: Register ref command in main.go**

Add to the `init()` function in `fish-speech-tts-gpu/cli/main.go`:

```go
	rootCmd.AddCommand(cmd.NewRefCmd(getServer))
```

- [ ] **Step 3: Verify it compiles**

```bash
cd fish-speech-tts-gpu/cli
go build -o fish-speech-cli .
./fish-speech-cli ref --help
./fish-speech-cli ref add --help
./fish-speech-cli ref list --help
```

Expected: Help text for ref and its subcommands.

- [ ] **Step 4: Commit**

```bash
git add fish-speech-tts-gpu/cli/cmd/ref.go fish-speech-tts-gpu/cli/main.go
git commit -m "feat(fish-speech-tts-gpu): add reference voice management commands"
```

---

### Task 8: Encode and Decode Commands

**Files:**
- Create: `fish-speech-tts-gpu/cli/cmd/encode.go`
- Create: `fish-speech-tts-gpu/cli/cmd/decode.go`
- Modify: `fish-speech-tts-gpu/cli/main.go`

- [ ] **Step 1: Create encode command**

Create `fish-speech-tts-gpu/cli/cmd/encode.go`:

```go
package cmd

import (
	"encoding/json"
	"fish-speech-cli/client"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func NewEncodeCmd(getServer func() string) *cobra.Command {
	var inputFile, outputFile string

	cmd := &cobra.Command{
		Use:   "encode",
		Short: "Encode audio to VQ tokens",
		Example: `  fish-speech-cli encode --input audio.wav --output tokens.json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if inputFile == "" {
				return fmt.Errorf("--input is required")
			}

			audioData, err := os.ReadFile(inputFile)
			if err != nil {
				return fmt.Errorf("read input: %w", err)
			}

			c := client.New(getServer())
			resp, err := c.Encode(audioData)
			if err != nil {
				return err
			}

			jsonData, err := json.MarshalIndent(resp.Tokens, "", "  ")
			if err != nil {
				return fmt.Errorf("marshal tokens: %w", err)
			}

			if outputFile != "" {
				if err := os.WriteFile(outputFile, jsonData, 0644); err != nil {
					return fmt.Errorf("write output: %w", err)
				}
				fmt.Fprintf(os.Stderr, "Tokens saved to %s\n", outputFile)
			} else {
				fmt.Println(string(jsonData))
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&inputFile, "input", "i", "", "Input audio file (required)")
	cmd.Flags().StringVarP(&outputFile, "output", "o", "", "Output JSON file (prints to stdout if omitted)")
	return cmd
}
```

- [ ] **Step 2: Create decode command**

Create `fish-speech-tts-gpu/cli/cmd/decode.go`:

```go
package cmd

import (
	"encoding/base64"
	"encoding/json"
	"fish-speech-cli/audio"
	"fish-speech-cli/client"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func NewDecodeCmd(getServer func() string) *cobra.Command {
	var inputFile, outputFile string
	var play bool

	cmd := &cobra.Command{
		Use:   "decode",
		Short: "Decode VQ tokens to audio",
		Example: `  fish-speech-cli decode --input tokens.json --output audio.wav
  fish-speech-cli decode --input tokens.json --play`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if inputFile == "" {
				return fmt.Errorf("--input is required")
			}

			tokenData, err := os.ReadFile(inputFile)
			if err != nil {
				return fmt.Errorf("read input: %w", err)
			}

			var tokens [][][]int
			if err := json.Unmarshal(tokenData, &tokens); err != nil {
				return fmt.Errorf("parse tokens: %w", err)
			}

			c := client.New(getServer())
			resp, err := c.Decode(tokens)
			if err != nil {
				return err
			}

			if len(resp.Audios) == 0 {
				return fmt.Errorf("no audio in response")
			}

			audioBytes, err := base64.StdEncoding.DecodeString(resp.Audios[0])
			if err != nil {
				return fmt.Errorf("decode audio base64: %w", err)
			}

			if outputFile != "" {
				if err := os.WriteFile(outputFile, audioBytes, 0644); err != nil {
					return fmt.Errorf("write output: %w", err)
				}
				fmt.Fprintf(os.Stderr, "Audio saved to %s\n", outputFile)
			}

			if play || outputFile == "" {
				fmt.Fprintf(os.Stderr, "Playing audio...\n")
				return audio.Play(audioBytes)
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&inputFile, "input", "i", "", "Input JSON token file (required)")
	cmd.Flags().StringVarP(&outputFile, "output", "o", "", "Output audio file")
	cmd.Flags().BoolVar(&play, "play", false, "Play audio after decoding")
	return cmd
}
```

- [ ] **Step 3: Register commands in main.go**

Add to the `init()` function in `fish-speech-tts-gpu/cli/main.go`:

```go
	rootCmd.AddCommand(cmd.NewEncodeCmd(getServer))
	rootCmd.AddCommand(cmd.NewDecodeCmd(getServer))
```

- [ ] **Step 4: Verify it compiles**

```bash
cd fish-speech-tts-gpu/cli
go build -o fish-speech-cli .
./fish-speech-cli encode --help
./fish-speech-cli decode --help
```

Expected: Help text for both commands.

- [ ] **Step 5: Commit**

```bash
git add fish-speech-tts-gpu/cli/cmd/encode.go fish-speech-tts-gpu/cli/cmd/decode.go fish-speech-tts-gpu/cli/main.go
git commit -m "feat(fish-speech-tts-gpu): add encode and decode commands"
```

---

### Task 9: Makefile and README

**Files:**
- Create: `fish-speech-tts-gpu/cli/Makefile`
- Create: `fish-speech-tts-gpu/README.md`
- Modify: `README.md` (root)

- [ ] **Step 1: Create Makefile**

Create `fish-speech-tts-gpu/cli/Makefile`:

```makefile
.PHONY: build test clean install

build:
	go build -o fish-speech-cli .

test:
	go test ./... -v

clean:
	rm -f fish-speech-cli

install:
	go install .
```

- [ ] **Step 2: Create README.md**

Create `fish-speech-tts-gpu/README.md`:

```markdown
# Fish Speech TTS (GPU)

NVIDIA L4 GPU を使用して、Fish Speech の音声合成（TTS）サーバーと WebUI をデプロイするサンプルです。Go で書かれた CLI クライアントを同梱しており、API 経由でテキスト音声変換とオーディオ再生が可能です。

## 構成

| サービス | ポート | 説明 |
|---------|--------|------|
| Fish Speech WebUI | 7860 | Gradio ベースの Web インターフェース |
| Fish Speech API | 8080 | REST API サーバー（CLI から利用） |

## 前提条件

- [conoha-cli](https://github.com/because-and/conoha-cli) がインストール済み
- SSH キーが登録済み
- **GPU フレーバー**: `g2l-t-c20m128g1-l4`（NVIDIA L4 GPU）

## GPU セットアップ

サーバー作成後、GPU ドライバのインストールが必要です。

### Step 1: サーバー作成

```bash
conoha server add --flavor g2l-t-c20m128g1-l4 --image ubuntu-24.04 --key mykey --name fish-speech
```

### Step 2: NVIDIA Container Toolkit インストール

```bash
conoha server ssh fish-speech
```

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Step 3: NVIDIA ドライバインストール

```bash
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu
```

### Step 4: サーバー再起動

```bash
exit
conoha server reboot fish-speech
```

### Step 5: ドライバ確認

```bash
conoha server ssh fish-speech
sudo apt install -y nvidia-utils-570-server
nvidia-smi
```

GPU が認識されていることを確認してください。

## デプロイ

```bash
conoha app deploy fish-speech --app fish-speech-tts-gpu
```

初回起動時は Fish Speech モデル（s2-pro）の自動ダウンロードが行われるため、数分かかります。2 回目以降はモデルがキャッシュされているため即座に起動します。

## 動作確認

### WebUI

ブラウザで `http://<サーバーIP>:7860` にアクセスしてください。

### API ヘルスチェック

```bash
curl http://<サーバーIP>:8080/v1/health
# {"status":"ok"}
```

### CLI から音声生成

```bash
curl -X POST http://<サーバーIP>:8080/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"こんにちは、世界！","format":"wav"}' \
  -o hello.wav
```

## Go CLI クライアント

### ビルド

```bash
cd cli
make build
```

Go 1.23 以上が必要です。Linux では ALSA 開発ライブラリも必要です：

```bash
# Ubuntu/Debian
sudo apt install libasound2-dev
```

### 使い方

```bash
# テキスト → スピーカー再生
./fish-speech-cli tts -t "こんにちは" --server http://<サーバーIP>:8080

# ファイルに保存
./fish-speech-cli tts -t "Hello, world!" -o hello.wav --server http://<サーバーIP>:8080

# 音声クローニング（リファレンス音声を使用）
./fish-speech-cli ref add --name my-voice --file voice.wav --text "音声のテキスト" --server http://<サーバーIP>:8080
./fish-speech-cli tts -t "クローニングされた声" --ref my-voice --server http://<サーバーIP>:8080

# リファレンス音声の管理
./fish-speech-cli ref list --server http://<サーバーIP>:8080
./fish-speech-cli ref delete --name my-voice --server http://<サーバーIP>:8080

# オーディオ → VQ トークン変換
./fish-speech-cli encode --input audio.wav --output tokens.json --server http://<サーバーIP>:8080
./fish-speech-cli decode --input tokens.json --output output.wav --server http://<サーバーIP>:8080

# ヘルスチェック
./fish-speech-cli health --server http://<サーバーIP>:8080
```

## カスタマイズ

### モデルの変更

`entrypoint.sh` のモデルパスを変更してください：

```bash
# s2-pro の代わりに openaudio-s1-mini を使用
MODEL_DIR="/app/checkpoints/openaudio-s1-mini"
```

`compose.yml` の `COMPILE` 環境変数で `torch.compile` 最適化を無効にできます：

```yaml
environment:
  - COMPILE=0
```

### API キーの設定

API サーバーに認証を追加するには、`entrypoint.sh` の API サーバー起動コマンドに `--api-key` フラグを追加してください。

## 関連リンク

- [Fish Speech](https://speech.fish.audio/) - 公式サイト
- [Fish Speech GitHub](https://github.com/fishaudio/fish-speech) - ソースコード
- [ConoHa VPS3](https://www.conoha.jp/vps/) - GPU フレーバー
```

- [ ] **Step 3: Update root README.md table**

Add a new row to the sample table in the root `README.md`. Find the `ollama-webui-gpu` row and add after it:

```markdown
| fish-speech-tts-gpu | Fish Speech + Go CLI | GPU 音声合成（TTS）+ 音声クローニング + CLI クライアント | g2l-t-c20m128g1-l4 |
```

- [ ] **Step 4: Verify Makefile**

```bash
cd fish-speech-tts-gpu/cli
make test
make build
make clean
```

Expected: tests pass, binary builds, binary cleaned up.

- [ ] **Step 5: Commit**

```bash
git add fish-speech-tts-gpu/cli/Makefile fish-speech-tts-gpu/README.md README.md
git commit -m "feat(fish-speech-tts-gpu): add Makefile, README, update root README"
```

---

## Self-Review Notes

**Spec coverage check:**
- Docker infrastructure (compose.yml, entrypoint.sh) — Task 1
- Go CLI scaffolding — Task 2
- API client (health, TTS, refs, encode/decode) — Task 3
- WAV audio player — Task 4
- Health command — Task 5
- TTS command with playback — Task 6
- Reference management (add/list/delete/update) — Task 7
- Encode/Decode commands — Task 8
- Makefile, README, root README update — Task 9
- Model skip-if-exists — Task 1 (entrypoint.sh checks `codec.pth`)
- GPU setup docs — Task 9 (README)

**Placeholder scan:** No TBD/TODO found. All steps have complete code.

**Type consistency check:**
- `TTSRequest` used consistently in client.go, client_test.go, and tts.go
- `client.New()` returns `*Client` — used consistently across all commands
- `getServer func() string` pattern consistent across all `NewXxxCmd` functions
- `audio.Play([]byte)` signature consistent between player.go and tts.go/decode.go
