package output

import (
	"bytes"
	"testing"
)

func TestPrintSuccess_Text(t *testing.T) {
	var buf bytes.Buffer
	p := NewPrinter(false, &buf)
	p.Success("Message pushed successfully", map[string]string{
		"Message ID": "12345",
		"To":         "U999",
	})
	out := buf.String()
	if !bytes.Contains([]byte(out), []byte("✓")) {
		t.Errorf("expected check mark in output, got: %s", out)
	}
	if !bytes.Contains([]byte(out), []byte("12345")) {
		t.Errorf("expected Message ID in output, got: %s", out)
	}
}

func TestPrintSuccess_JSON(t *testing.T) {
	var buf bytes.Buffer
	p := NewPrinter(true, &buf)
	p.Success("ok", map[string]string{"id": "123"})
	out := buf.String()
	if !bytes.Contains([]byte(out), []byte(`"id"`)) {
		t.Errorf("expected JSON key in output, got: %s", out)
	}
}

func TestPrintError_Text(t *testing.T) {
	var buf bytes.Buffer
	p := NewPrinter(false, &buf)
	p.Error(400, "Invalid reply token")
	out := buf.String()
	if !bytes.Contains([]byte(out), []byte("✗")) {
		t.Errorf("expected cross mark in output, got: %s", out)
	}
}

func TestPrintError_JSON(t *testing.T) {
	var buf bytes.Buffer
	p := NewPrinter(true, &buf)
	p.Error(400, "Invalid reply token")
	out := buf.String()
	if !bytes.Contains([]byte(out), []byte(`"error"`)) {
		t.Errorf("expected error key in JSON output, got: %s", out)
	}
}

func TestPrintRaw_JSON(t *testing.T) {
	var buf bytes.Buffer
	p := NewPrinter(true, &buf)
	data := map[string]any{"access_token": "abc", "expires_in": 3600}
	p.Raw(data)
	out := buf.String()
	if !bytes.Contains([]byte(out), []byte("abc")) {
		t.Errorf("expected token in output, got: %s", out)
	}
}
