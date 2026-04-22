package output

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
)

type Printer struct {
	jsonMode bool
	w        io.Writer
	errW     io.Writer
}

func NewPrinter(jsonMode bool, w io.Writer) *Printer {
	return NewPrinterWithErr(jsonMode, w, nil)
}

func NewPrinterWithErr(jsonMode bool, w io.Writer, errW io.Writer) *Printer {
	if w == nil {
		w = os.Stdout
	}
	if errW == nil {
		errW = os.Stderr
	}
	return &Printer{jsonMode: jsonMode, w: w, errW: errW}
}

// Success prints a success message with key-value details.
func (p *Printer) Success(msg string, fields map[string]string) {
	if p.jsonMode {
		data := make(map[string]any, len(fields)+1)
		data["message"] = msg
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

// Error prints an error message to the error writer (stderr by default).
func (p *Printer) Error(status int, msg string) {
	if p.jsonMode {
		enc := json.NewEncoder(p.errW)
		enc.SetIndent("", "  ")
		enc.Encode(map[string]any{
			"error":   true,
			"status":  status,
			"message": msg,
		})
		return
	}
	fmt.Fprintf(p.errW, "✗ Failed (%d)\n", status)
	fmt.Fprintf(p.errW, "  %s\n", msg)
}

// Raw prints arbitrary data. JSON mode marshals the value. Text mode renders
// map[string]any as sorted key: value lines, and any other value (including
// structs and slices) as pretty-printed JSON so field names are preserved.
func (p *Printer) Raw(data any) {
	if p.jsonMode {
		p.writeJSON(data)
		return
	}
	switch v := data.(type) {
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Fprintf(p.w, "  %s: %v\n", k, v[k])
		}
	default:
		buf, err := json.MarshalIndent(data, "", "  ")
		if err != nil {
			fmt.Fprintf(p.w, "%v\n", data)
			return
		}
		fmt.Fprintln(p.w, string(buf))
	}
}

func (p *Printer) writeJSON(data any) {
	enc := json.NewEncoder(p.w)
	enc.SetIndent("", "  ")
	enc.Encode(data)
}

var statusCodeRe = regexp.MustCompile(`unexpected status code: (\d{3})`)

// ExtractHTTPStatus tries to extract an HTTP status code from an SDK error.
// Returns 0 if not found.
func ExtractHTTPStatus(err error) int {
	if err == nil {
		return 0
	}
	m := statusCodeRe.FindStringSubmatch(err.Error())
	if len(m) < 2 {
		return 0
	}
	code, convErr := strconv.Atoi(m[1])
	if convErr != nil {
		return 0
	}
	return code
}
