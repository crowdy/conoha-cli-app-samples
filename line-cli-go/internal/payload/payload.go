package payload

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"line-cli-go/internal/config"
)

// LoadJSON reads path and json.Unmarshals into v.
// When path == "-", reads from os.Stdin.
// Returns config.ClientError for user mistakes (file missing, invalid JSON).
func LoadJSON(path string, v any) error {
	if path == "" {
		return &config.ClientError{Msg: "--payload-file is required"}
	}
	var r io.Reader
	if path == "-" {
		r = os.Stdin
	} else {
		f, err := os.Open(path)
		if err != nil {
			return &config.ClientError{Msg: fmt.Sprintf("reading %s: %v", path, err)}
		}
		defer f.Close()
		r = f
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return &config.ClientError{Msg: fmt.Sprintf("reading %s: %v", path, err)}
	}
	if err := json.Unmarshal(data, v); err != nil {
		return &config.ClientError{Msg: fmt.Sprintf("parsing %s: %v", path, err)}
	}
	return nil
}
