package output

import (
	"bytes"
	"errors"
	"fmt"
	"testing"
)

func TestPrintedSentinel(t *testing.T) {
	base := errors.New("boom")
	wrapped := Printed(base)
	if !errors.Is(wrapped, ErrPrinted) {
		t.Fatal("errors.Is(wrapped, ErrPrinted) = false, want true")
	}
	if !errors.Is(wrapped, base) {
		t.Fatal("errors.Is(wrapped, base) = false, want true (chain broken)")
	}
	if Printed(nil) != nil {
		t.Fatal("Printed(nil) should return nil")
	}
	if got := Printed(wrapped); got != wrapped {
		t.Fatal("Printed should be idempotent")
	}
}

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
	if !bytes.Contains([]byte(out), []byte(`"message"`)) {
		t.Errorf("expected message key in JSON output, got: %s", out)
	}
}

func TestPrintError_Text(t *testing.T) {
	var errBuf bytes.Buffer
	p := NewPrinterWithErr(false, nil, &errBuf)
	p.Error(400, "Invalid reply token")
	out := errBuf.String()
	if !bytes.Contains([]byte(out), []byte("✗")) {
		t.Errorf("expected cross mark in error output, got: %s", out)
	}
}

func TestPrintError_JSON(t *testing.T) {
	var errBuf bytes.Buffer
	p := NewPrinterWithErr(true, nil, &errBuf)
	p.Error(400, "Invalid reply token")
	out := errBuf.String()
	if !bytes.Contains([]byte(out), []byte(`"error"`)) {
		t.Errorf("expected error key in JSON error output, got: %s", out)
	}
}

func TestPrintError_GoesToErrWriter(t *testing.T) {
	var stdBuf, errBuf bytes.Buffer
	p := NewPrinterWithErr(false, &stdBuf, &errBuf)
	p.Error(500, "Internal server error")
	if stdBuf.Len() != 0 {
		t.Errorf("expected no output on stdout writer, got: %s", stdBuf.String())
	}
	if errBuf.Len() == 0 {
		t.Error("expected output on stderr writer, got nothing")
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

func TestPrintRaw_TextSortedKeys(t *testing.T) {
	var buf bytes.Buffer
	p := NewPrinter(false, &buf)
	data := map[string]any{"zebra": 1, "apple": 2, "mango": 3}
	p.Raw(data)
	out := buf.String()
	expected := "  apple: 2\n  mango: 3\n  zebra: 1\n"
	if out != expected {
		t.Errorf("expected sorted output:\n%s\ngot:\n%s", expected, out)
	}
}

func TestPrintRaw_TextStructPreservesFieldNames(t *testing.T) {
	type inner struct {
		AliasID    string `json:"richMenuAliasId"`
		RichMenuID string `json:"richMenuId"`
	}
	type outer struct {
		Aliases []inner `json:"aliases"`
	}
	var buf bytes.Buffer
	p := NewPrinter(false, &buf)
	p.Raw(outer{Aliases: []inner{{AliasID: "a1", RichMenuID: "rm1"}}})
	out := buf.String()
	for _, want := range []string{"richMenuAliasId", "richMenuId", "a1", "rm1"} {
		if !bytes.Contains([]byte(out), []byte(want)) {
			t.Errorf("expected %q in text output, got:\n%s", want, out)
		}
	}
}

func TestExtractHTTPStatus(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{"nil error", nil, 0},
		{"no status", fmt.Errorf("something went wrong"), 0},
		{"400 status", fmt.Errorf("unexpected status code: 400, bad request"), 400},
		{"404 status", fmt.Errorf("unexpected status code: 404, not found"), 404},
		{"500 status", fmt.Errorf("unexpected status code: 500, internal error"), 500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExtractHTTPStatus(tt.err)
			if got != tt.want {
				t.Errorf("ExtractHTTPStatus() = %d, want %d", got, tt.want)
			}
		})
	}
}
