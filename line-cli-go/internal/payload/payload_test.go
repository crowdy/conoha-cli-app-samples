package payload

import (
	"errors"
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
