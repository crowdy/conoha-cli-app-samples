package output

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

type Printer struct {
	jsonMode bool
	w        io.Writer
}

func NewPrinter(jsonMode bool, w io.Writer) *Printer {
	if w == nil {
		w = os.Stdout
	}
	return &Printer{jsonMode: jsonMode, w: w}
}

// Success prints a success message with key-value details.
func (p *Printer) Success(msg string, fields map[string]string) {
	if p.jsonMode {
		data := make(map[string]any, len(fields))
		for k, v := range fields {
			data[k] = v
		}
		p.writeJSON(data)
		return
	}
	fmt.Fprintf(p.w, "✓ %s\n", msg)
	for k, v := range fields {
		fmt.Fprintf(p.w, "  %s: %s\n", k, v)
	}
}

// Error prints an error message.
func (p *Printer) Error(status int, msg string) {
	if p.jsonMode {
		p.writeJSON(map[string]any{
			"error":   true,
			"status":  status,
			"message": msg,
		})
		return
	}
	fmt.Fprintf(p.w, "✗ Failed (%d)\n", status)
	fmt.Fprintf(p.w, "  %s\n", msg)
}

// Raw prints arbitrary data (JSON mode: marshal; text mode: formatted key-value).
func (p *Printer) Raw(data any) {
	if p.jsonMode {
		p.writeJSON(data)
		return
	}
	switch v := data.(type) {
	case map[string]any:
		for k, val := range v {
			fmt.Fprintf(p.w, "  %s: %v\n", k, val)
		}
	default:
		fmt.Fprintf(p.w, "%v\n", data)
	}
}

func (p *Printer) writeJSON(data any) {
	enc := json.NewEncoder(p.w)
	enc.SetIndent("", "  ")
	enc.Encode(data)
}
