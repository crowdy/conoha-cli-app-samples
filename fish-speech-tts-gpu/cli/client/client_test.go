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
