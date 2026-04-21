package payload

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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

// LoadImage opens path as an image and returns (reader, contentType).
// path == "-" reads from os.Stdin and sniffs content-type via http.DetectContentType.
// For file paths, content-type is determined by extension (.png / .jpg / .jpeg);
// unknown extensions fall back to http.DetectContentType on the first 512 bytes.
// Returns config.ClientError for user mistakes.
func LoadImage(path string) (io.ReadCloser, string, error) {
	if path == "" {
		return nil, "", &config.ClientError{Msg: "--image is required"}
	}
	if path == "-" {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return nil, "", &config.ClientError{Msg: fmt.Sprintf("reading stdin: %v", err)}
		}
		ct := http.DetectContentType(data)
		return io.NopCloser(bytes.NewReader(data)), ct, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, "", &config.ClientError{Msg: fmt.Sprintf("opening %s: %v", path, err)}
	}
	ct := contentTypeByExt(path)
	if ct == "" {
		// Sniff by reading first 512 bytes, then rewind.
		head := make([]byte, 512)
		n, _ := io.ReadFull(f, head)
		ct = http.DetectContentType(head[:n])
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			f.Close()
			return nil, "", &config.ClientError{Msg: fmt.Sprintf("seek %s: %v", path, err)}
		}
	}
	return f, ct, nil
}

func contentTypeByExt(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	}
	return ""
}
