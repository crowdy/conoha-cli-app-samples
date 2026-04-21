package payload

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"line-cli-go/internal/config"
)

func writeTemp(t *testing.T, name, body string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadJSON(t *testing.T) {
	t.Run("happy path", func(t *testing.T) {
		p := writeTemp(t, "x.json", `{"name":"foo"}`)
		var v struct {
			Name string `json:"name"`
		}
		if err := LoadJSON(p, &v); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if v.Name != "foo" {
			t.Errorf("Name = %q, want %q", v.Name, "foo")
		}
	})

	t.Run("empty path returns ClientError", func(t *testing.T) {
		var v any
		err := LoadJSON("", &v)
		var ce *config.ClientError
		if !errors.As(err, &ce) {
			t.Fatalf("expected ClientError, got %T: %v", err, err)
		}
	})

	t.Run("missing file returns ClientError", func(t *testing.T) {
		var v any
		err := LoadJSON("/nonexistent/file.json", &v)
		var ce *config.ClientError
		if !errors.As(err, &ce) {
			t.Fatalf("expected ClientError, got %T: %v", err, err)
		}
	})

	t.Run("invalid JSON returns ClientError", func(t *testing.T) {
		p := writeTemp(t, "bad.json", `{ not json`)
		var v any
		err := LoadJSON(p, &v)
		var ce *config.ClientError
		if !errors.As(err, &ce) {
			t.Fatalf("expected ClientError, got %T: %v", err, err)
		}
		if !strings.Contains(ce.Msg, "parsing") {
			t.Errorf("expected 'parsing' in message, got %q", ce.Msg)
		}
	})

	t.Run("stdin with dash", func(t *testing.T) {
		r, w, _ := os.Pipe()
		orig := os.Stdin
		os.Stdin = r
		t.Cleanup(func() { os.Stdin = orig })
		go func() {
			w.Write([]byte(`{"name":"piped"}`))
			w.Close()
		}()
		var v struct {
			Name string `json:"name"`
		}
		if err := LoadJSON("-", &v); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if v.Name != "piped" {
			t.Errorf("Name = %q, want %q", v.Name, "piped")
		}
	})
}

func TestLoadImage(t *testing.T) {
	// Minimal PNG header (8-byte signature + IHDR), enough for DetectContentType.
	pngBytes := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13}
	jpegBytes := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 'J', 'F', 'I', 'F'}

	writeBin := func(t *testing.T, name string, body []byte) string {
		t.Helper()
		dir := t.TempDir()
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, body, 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}

	cases := []struct {
		name   string
		file   string
		body   []byte
		wantCT string
	}{
		{"png extension", "m.png", pngBytes, "image/png"},
		{"jpg extension", "m.jpg", jpegBytes, "image/jpeg"},
		{"jpeg extension", "m.jpeg", jpegBytes, "image/jpeg"},
		{"no extension falls back to sniff", "image", pngBytes, "image/png"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := writeBin(t, tc.file, tc.body)
			rc, ct, err := LoadImage(p)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			defer rc.Close()
			if ct != tc.wantCT {
				t.Errorf("contentType = %q, want %q", ct, tc.wantCT)
			}
			got, _ := io.ReadAll(rc)
			if len(got) != len(tc.body) {
				t.Errorf("read %d bytes, want %d", len(got), len(tc.body))
			}
		})
	}

	t.Run("empty path returns ClientError", func(t *testing.T) {
		_, _, err := LoadImage("")
		var ce *config.ClientError
		if !errors.As(err, &ce) {
			t.Fatalf("expected ClientError, got %T: %v", err, err)
		}
	})

	t.Run("missing file returns ClientError", func(t *testing.T) {
		_, _, err := LoadImage("/nonexistent.png")
		var ce *config.ClientError
		if !errors.As(err, &ce) {
			t.Fatalf("expected ClientError, got %T: %v", err, err)
		}
	})

	t.Run("stdin sniffs content type", func(t *testing.T) {
		r, w, _ := os.Pipe()
		orig := os.Stdin
		os.Stdin = r
		t.Cleanup(func() { os.Stdin = orig })
		go func() {
			w.Write(pngBytes)
			w.Close()
		}()
		rc, ct, err := LoadImage("-")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		defer rc.Close()
		if ct != "image/png" {
			t.Errorf("contentType = %q, want %q", ct, "image/png")
		}
	})
}
