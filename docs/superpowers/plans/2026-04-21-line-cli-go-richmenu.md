# line-cli-go: Rich Menu (Core + Linking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 15 LINE Messaging API Rich Menu endpoints (core CRUD + image + default + linking) as cobra subcommands in `line-cli-go`. Alias + batch are out of scope for this PR (planned for PR-2).

**Architecture:** Single new `richmenu` subcommand group under `cmd/`, with 15 sibling command files. One new `internal/payload/` helper for `--payload-file` / `--image` parsing. Existing `client.NewMessagingAPI()` / `NewMessagingBlobAPI()` are reused as-is; `internal/output.Printer` handles JSON/text output. 15 commands are thin wrappers around `line-bot-sdk-go/v8` methods.

**Tech Stack:** Go 1.26, cobra, viper, `github.com/line/line-bot-sdk-go/v8`.

**All work from `line-cli-go/` directory of the monorepo.**

**Spec reference:** `docs/superpowers/specs/2026-04-21-line-cli-go-richmenu-design.md`

---

## File Structure

**New files:**
- `line-cli-go/internal/payload/payload.go` — `LoadJSON` / `LoadImage` helpers
- `line-cli-go/internal/payload/payload_test.go` — unit tests
- `line-cli-go/cmd/richmenu/richmenu.go` — group root
- `line-cli-go/cmd/richmenu/list.go`
- `line-cli-go/cmd/richmenu/get.go`
- `line-cli-go/cmd/richmenu/get_default.go`
- `line-cli-go/cmd/richmenu/get_for_user.go`
- `line-cli-go/cmd/richmenu/delete.go`
- `line-cli-go/cmd/richmenu/set_default.go`
- `line-cli-go/cmd/richmenu/cancel_default.go`
- `line-cli-go/cmd/richmenu/link.go`
- `line-cli-go/cmd/richmenu/unlink.go`
- `line-cli-go/cmd/richmenu/create.go`
- `line-cli-go/cmd/richmenu/validate.go`
- `line-cli-go/cmd/richmenu/set_image.go`
- `line-cli-go/cmd/richmenu/get_image.go`
- `line-cli-go/cmd/richmenu/bulk_link.go`
- `line-cli-go/cmd/richmenu/bulk_unlink.go`
- `line-cli-go/test/integration/richmenu_test.go`
- `line-cli-go/test/integration/testdata/rm.json`
- `line-cli-go/test/integration/testdata/rm.png`
- `line-cli-go/test/integration/testdata/bulk.json`

**Modified files:**
- `line-cli-go/cmd/root.go` — register `richmenu.RichMenuCmd`
- `line-cli-go/README.md` — add richmenu section
- `docs/superpowers/specs/2026-04-18-line-cli-go-design.md` — update "スコープ外" to note richmenu is now PR-1-implemented (alias+batch still pending)

---

## Task 1: `internal/payload/` Helper — LoadJSON (TDD)

**Files:**
- Create: `line-cli-go/internal/payload/payload.go`
- Create: `line-cli-go/internal/payload/payload_test.go`

- [ ] **Step 1: Create empty package**

Create `line-cli-go/internal/payload/payload.go`:

```go
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
```

- [ ] **Step 2: Write failing tests for LoadJSON**

Create `line-cli-go/internal/payload/payload_test.go`:

```go
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
```

- [ ] **Step 3: Run tests, verify all pass**

Run from `line-cli-go/`:

```bash
go test ./internal/payload/... -v -run TestLoadJSON
```

Expected: `PASS` with 5 subtests passing.

- [ ] **Step 4: Commit**

```bash
cd line-cli-go
git add internal/payload/payload.go internal/payload/payload_test.go
git commit -m "feat(line-cli-go): add payload.LoadJSON helper"
```

---

## Task 2: `internal/payload/` Helper — LoadImage (TDD)

**Files:**
- Modify: `line-cli-go/internal/payload/payload.go`
- Modify: `line-cli-go/internal/payload/payload_test.go`

- [ ] **Step 1: Add LoadImage to payload.go**

First, merge these new imports into the existing `import (...)` block at the top of `internal/payload/payload.go` (do not create a second import block — extend the existing one):

- `"bytes"`
- `"net/http"`
- `"path/filepath"`
- `"strings"`

The final import block should contain (in standard `goimports` ordering: stdlib first, blank line, then local packages):

```go
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
```

Then append the following two functions at the end of `internal/payload/payload.go`:

```go
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
```

- [ ] **Step 2: Add failing tests for LoadImage**

Append to `internal/payload/payload_test.go`:

```go
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
```

Missing imports are already covered by step 1 (`io`, `errors`, `os`, etc.).

- [ ] **Step 3: Run tests, verify all pass**

```bash
go test ./internal/payload/... -v
```

Expected: `PASS` with all subtests passing (both TestLoadJSON and TestLoadImage).

- [ ] **Step 4: Commit**

```bash
git add internal/payload/payload.go internal/payload/payload_test.go
git commit -m "feat(line-cli-go): add payload.LoadImage helper"
```

---

## Task 3: `cmd/richmenu/` Group Scaffold

**Files:**
- Create: `line-cli-go/cmd/richmenu/richmenu.go`
- Modify: `line-cli-go/cmd/root.go`

- [ ] **Step 1: Create group root**

Create `line-cli-go/cmd/richmenu/richmenu.go`:

```go
package richmenu

import "github.com/spf13/cobra"

// RichMenuCmd is the root of the `richmenu` subcommand group.
// Sibling files attach their individual verbs via init() -> RichMenuCmd.AddCommand(...).
var RichMenuCmd = &cobra.Command{
	Use:   "richmenu",
	Short: "Rich Menu CRUD, image, default, and user linking",
}
```

- [ ] **Step 2: Register in root**

Modify `line-cli-go/cmd/root.go` — add import and AddCommand line.

Add to the import group (keep alphabetical within group):

```go
"line-cli-go/cmd/richmenu"
```

Add inside `init()` after the other `rootCmd.AddCommand` calls:

```go
rootCmd.AddCommand(richmenu.RichMenuCmd)
```

- [ ] **Step 3: Build and smoke test**

```bash
cd line-cli-go
go build ./... && ./line-cli-go richmenu --help
```

Expected: help output showing "Rich Menu CRUD, image, default, and user linking" with empty command list.

- [ ] **Step 4: Commit**

```bash
git add cmd/richmenu/richmenu.go cmd/root.go
git commit -m "feat(line-cli-go): add richmenu subcommand group scaffold"
```

---

## Task 4: `richmenu list`

**Files:**
- Create: `line-cli-go/cmd/richmenu/list.go`

- [ ] **Step 1: Create list command**

Create `line-cli-go/cmd/richmenu/list.go`:

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List all rich menus",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenuList()
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	RichMenuCmd.AddCommand(listCmd)
}
```

- [ ] **Step 2: Build and smoke test**

```bash
go build ./... && ./line-cli-go richmenu list --help
```

Expected: help output shows `Usage: line-cli-go richmenu list [flags]`.

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/list.go
git commit -m "feat(line-cli-go): add richmenu list"
```

---

## Task 5: `richmenu get`

**Files:**
- Create: `line-cli-go/cmd/richmenu/get.go`

- [ ] **Step 1: Create get command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get a rich menu by ID",
	RunE: func(cmd *cobra.Command, args []string) error {
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenu(richMenuID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	getCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	RichMenuCmd.AddCommand(getCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/get.go
git commit -m "feat(line-cli-go): add richmenu get"
```

---

## Task 6: `richmenu get-default`

**Files:**
- Create: `line-cli-go/cmd/richmenu/get_default.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getDefaultCmd = &cobra.Command{
	Use:   "get-default",
	Short: "Get the default rich menu ID",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetDefaultRichMenuId()
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	RichMenuCmd.AddCommand(getDefaultCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/get_default.go
git commit -m "feat(line-cli-go): add richmenu get-default"
```

---

## Task 7: `richmenu get-for-user`

**Files:**
- Create: `line-cli-go/cmd/richmenu/get_for_user.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getForUserCmd = &cobra.Command{
	Use:   "get-for-user",
	Short: "Get the rich menu ID linked to a user",
	RunE: func(cmd *cobra.Command, args []string) error {
		userID, _ := cmd.Flags().GetString("user-id")
		if userID == "" {
			return &config.ClientError{Msg: "--user-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenuIdOfUser(userID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	getForUserCmd.Flags().String("user-id", "", "user ID (required)")
	RichMenuCmd.AddCommand(getForUserCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/get_for_user.go
git commit -m "feat(line-cli-go): add richmenu get-for-user"
```

---

## Task 8: `richmenu delete`

**Files:**
- Create: `line-cli-go/cmd/richmenu/delete.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var deleteCmd = &cobra.Command{
	Use:   "delete",
	Short: "Delete a rich menu",
	RunE: func(cmd *cobra.Command, args []string) error {
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.DeleteRichMenu(richMenuID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu deleted", map[string]string{"richMenuId": richMenuID})
		return nil
	},
}

func init() {
	deleteCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	RichMenuCmd.AddCommand(deleteCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/delete.go
git commit -m "feat(line-cli-go): add richmenu delete"
```

---

## Task 9: `richmenu set-default`

**Files:**
- Create: `line-cli-go/cmd/richmenu/set_default.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var setDefaultCmd = &cobra.Command{
	Use:   "set-default",
	Short: "Set the default rich menu for all users",
	RunE: func(cmd *cobra.Command, args []string) error {
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.SetDefaultRichMenu(richMenuID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Default rich menu set", map[string]string{"richMenuId": richMenuID})
		return nil
	},
}

func init() {
	setDefaultCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	RichMenuCmd.AddCommand(setDefaultCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/set_default.go
git commit -m "feat(line-cli-go): add richmenu set-default"
```

---

## Task 10: `richmenu cancel-default`

**Files:**
- Create: `line-cli-go/cmd/richmenu/cancel_default.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var cancelDefaultCmd = &cobra.Command{
	Use:   "cancel-default",
	Short: "Cancel the default rich menu",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.CancelDefaultRichMenu(); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Default rich menu cancelled", nil)
		return nil
	},
}

func init() {
	RichMenuCmd.AddCommand(cancelDefaultCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/cancel_default.go
git commit -m "feat(line-cli-go): add richmenu cancel-default"
```

---

## Task 11: `richmenu link`

**Files:**
- Create: `line-cli-go/cmd/richmenu/link.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var linkCmd = &cobra.Command{
	Use:   "link",
	Short: "Link a rich menu to a user",
	RunE: func(cmd *cobra.Command, args []string) error {
		userID, _ := cmd.Flags().GetString("user-id")
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		if userID == "" {
			return &config.ClientError{Msg: "--user-id is required"}
		}
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.LinkRichMenuIdToUser(userID, richMenuID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu linked", map[string]string{"userId": userID, "richMenuId": richMenuID})
		return nil
	},
}

func init() {
	linkCmd.Flags().String("user-id", "", "user ID (required)")
	linkCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	RichMenuCmd.AddCommand(linkCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/link.go
git commit -m "feat(line-cli-go): add richmenu link"
```

---

## Task 12: `richmenu unlink`

**Files:**
- Create: `line-cli-go/cmd/richmenu/unlink.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var unlinkCmd = &cobra.Command{
	Use:   "unlink",
	Short: "Unlink the rich menu from a user",
	RunE: func(cmd *cobra.Command, args []string) error {
		userID, _ := cmd.Flags().GetString("user-id")
		if userID == "" {
			return &config.ClientError{Msg: "--user-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.UnlinkRichMenuIdFromUser(userID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu unlinked", map[string]string{"userId": userID})
		return nil
	},
}

func init() {
	unlinkCmd.Flags().String("user-id", "", "user ID (required)")
	RichMenuCmd.AddCommand(unlinkCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/unlink.go
git commit -m "feat(line-cli-go): add richmenu unlink"
```

---

## Task 13: `richmenu create`

**Files:**
- Create: `line-cli-go/cmd/richmenu/create.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var createCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a rich menu from a JSON payload",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		var req messaging_api.RichMenuRequest
		if err := payload.LoadJSON(payloadFile, &req); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.CreateRichMenu(&req)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	createCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin) (required)")
	RichMenuCmd.AddCommand(createCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/create.go
git commit -m "feat(line-cli-go): add richmenu create"
```

---

## Task 14: `richmenu validate`

**Files:**
- Create: `line-cli-go/cmd/richmenu/validate.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var validateCmd = &cobra.Command{
	Use:   "validate",
	Short: "Validate a rich menu JSON payload without creating it",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		var req messaging_api.RichMenuRequest
		if err := payload.LoadJSON(payloadFile, &req); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.ValidateRichMenuObject(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu payload valid", nil)
		return nil
	},
}

func init() {
	validateCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin) (required)")
	RichMenuCmd.AddCommand(validateCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/validate.go
git commit -m "feat(line-cli-go): add richmenu validate"
```

---

## Task 15: `richmenu set-image`

**Files:**
- Create: `line-cli-go/cmd/richmenu/set_image.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/spf13/cobra"
)

var setImageCmd = &cobra.Command{
	Use:   "set-image",
	Short: "Upload a rich menu image (PNG/JPEG)",
	RunE: func(cmd *cobra.Command, args []string) error {
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		imagePath, _ := cmd.Flags().GetString("image")
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		reader, contentType, err := payload.LoadImage(imagePath)
		if err != nil {
			return err
		}
		defer reader.Close()

		p := output.NewPrinter(config.JSONMode(), nil)
		blob, err := client.NewMessagingBlobAPI()
		if err != nil {
			return err
		}
		if _, err := blob.SetRichMenuImage(richMenuID, contentType, reader); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu image uploaded", map[string]string{
			"richMenuId":  richMenuID,
			"contentType": contentType,
		})
		return nil
	},
}

func init() {
	setImageCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	setImageCmd.Flags().String("image", "", "image file path (use '-' for stdin) (required)")
	RichMenuCmd.AddCommand(setImageCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/set_image.go
git commit -m "feat(line-cli-go): add richmenu set-image"
```

---

## Task 16: `richmenu get-image`

**Files:**
- Create: `line-cli-go/cmd/richmenu/get_image.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"fmt"
	"io"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getImageCmd = &cobra.Command{
	Use:   "get-image",
	Short: "Download a rich menu image",
	RunE: func(cmd *cobra.Command, args []string) error {
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		outPath, _ := cmd.Flags().GetString("output")
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		blob, err := client.NewMessagingBlobAPI()
		if err != nil {
			return err
		}
		resp, err := blob.GetRichMenuImage(richMenuID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		defer resp.Body.Close()

		if outPath != "" {
			f, err := os.Create(outPath)
			if err != nil {
				return fmt.Errorf("creating output file: %w", err)
			}
			defer f.Close()
			n, err := io.Copy(f, resp.Body)
			if err != nil {
				return fmt.Errorf("writing image: %w", err)
			}
			p.Success("Rich menu image saved", map[string]string{
				"file":  outPath,
				"bytes": fmt.Sprintf("%d", n),
			})
			return nil
		}
		if _, err := io.Copy(os.Stdout, resp.Body); err != nil {
			return fmt.Errorf("writing image to stdout: %w", err)
		}
		return nil
	},
}

func init() {
	getImageCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	getImageCmd.Flags().String("output", "", "save to file path (default: stdout)")
	RichMenuCmd.AddCommand(getImageCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/get_image.go
git commit -m "feat(line-cli-go): add richmenu get-image"
```

---

## Task 17: `richmenu bulk-link`

**Files:**
- Create: `line-cli-go/cmd/richmenu/bulk_link.go`

Supports two input styles (per spec):
- `--user-ids U1,U2,U3` (comma-separated) + `--rich-menu-id RM`
- `--payload-file bulk.json` with full `RichMenuBulkLinkRequest` body
- Both together: payload-file is base, flags override fields when non-empty

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"strconv"
	"strings"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var bulkLinkCmd = &cobra.Command{
	Use:   "bulk-link",
	Short: "Link a rich menu to multiple users",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		userIDsCSV, _ := cmd.Flags().GetString("user-ids")

		var req messaging_api.RichMenuBulkLinkRequest
		if payloadFile != "" {
			if err := payload.LoadJSON(payloadFile, &req); err != nil {
				return err
			}
		}
		if richMenuID != "" {
			req.RichMenuId = richMenuID
		}
		if userIDsCSV != "" {
			req.UserIds = splitCSV(userIDsCSV)
		}
		if req.RichMenuId == "" {
			return &config.ClientError{Msg: "--rich-menu-id (or payload richMenuId) is required"}
		}
		if len(req.UserIds) == 0 {
			return &config.ClientError{Msg: "--user-ids (or payload userIds) is required"}
		}

		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.LinkRichMenuIdToUsers(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Bulk link accepted", map[string]string{
			"richMenuId": req.RichMenuId,
			"userCount":  strconv.Itoa(len(req.UserIds)),
		})
		return nil
	},
}

func init() {
	bulkLinkCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin)")
	bulkLinkCmd.Flags().String("rich-menu-id", "", "rich menu ID (overrides payload)")
	bulkLinkCmd.Flags().String("user-ids", "", "comma-separated user IDs (overrides payload)")
	RichMenuCmd.AddCommand(bulkLinkCmd)
}

// splitCSV is shared by bulk-link and bulk-unlink (same package).
func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/bulk_link.go
git commit -m "feat(line-cli-go): add richmenu bulk-link"
```

---

## Task 18: `richmenu bulk-unlink`

**Files:**
- Create: `line-cli-go/cmd/richmenu/bulk_unlink.go`

- [ ] **Step 1: Create command**

```go
package richmenu

import (
	"strconv"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var bulkUnlinkCmd = &cobra.Command{
	Use:   "bulk-unlink",
	Short: "Unlink rich menus from multiple users",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		userIDsCSV, _ := cmd.Flags().GetString("user-ids")

		var req messaging_api.RichMenuBulkUnlinkRequest
		if payloadFile != "" {
			if err := payload.LoadJSON(payloadFile, &req); err != nil {
				return err
			}
		}
		if userIDsCSV != "" {
			req.UserIds = splitCSV(userIDsCSV)
		}
		if len(req.UserIds) == 0 {
			return &config.ClientError{Msg: "--user-ids (or payload userIds) is required"}
		}

		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.UnlinkRichMenuIdFromUsers(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Bulk unlink accepted", map[string]string{
			"userCount": strconv.Itoa(len(req.UserIds)),
		})
		return nil
	},
}

func init() {
	bulkUnlinkCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin)")
	bulkUnlinkCmd.Flags().String("user-ids", "", "comma-separated user IDs (overrides payload)")
	RichMenuCmd.AddCommand(bulkUnlinkCmd)
}
```

Note: `splitCSV` is already defined in `bulk_link.go` (same package) and is reused here.

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add cmd/richmenu/bulk_unlink.go
git commit -m "feat(line-cli-go): add richmenu bulk-unlink"
```

---

## Task 19: Integration testdata

**Files:**
- Create: `line-cli-go/test/integration/testdata/rm.json`
- Create: `line-cli-go/test/integration/testdata/rm.png`
- Create: `line-cli-go/test/integration/testdata/bulk.json`

- [ ] **Step 1: Create rm.json**

Create `line-cli-go/test/integration/testdata/rm.json`:

```json
{
  "size": { "width": 2500, "height": 1686 },
  "selected": false,
  "name": "test-menu",
  "chatBarText": "Menu",
  "areas": [
    {
      "bounds": { "x": 0, "y": 0, "width": 2500, "height": 1686 },
      "action": { "type": "message", "text": "hello" }
    }
  ]
}
```

- [ ] **Step 2: Create 2500x1686 PNG**

Use a one-shot Go program to write a valid PNG of the exact dimensions LINE requires. Write the program to a temp file, run it, then delete it.

```bash
cd line-cli-go/test/integration/testdata
cat > /tmp/genrm.go <<'EOF'
package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
)

func main() {
	img := image.NewRGBA(image.Rect(0, 0, 2500, 1686))
	grey := color.RGBA{R: 200, G: 200, B: 200, A: 255}
	for y := 0; y < 1686; y++ {
		for x := 0; x < 2500; x++ {
			img.Set(x, y, grey)
		}
	}
	f, err := os.Create("rm.png")
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		panic(err)
	}
}
EOF
go run /tmp/genrm.go
rm /tmp/genrm.go
```

Expected: creates `rm.png` (~30 KB solid-grey PNG at 2500x1686). Verify dimensions:

```bash
file rm.png
# Expected: PNG image data, 2500 x 1686, 8-bit/color RGBA, non-interlaced
```

- [ ] **Step 3: Create bulk.json template**

Create `line-cli-go/test/integration/testdata/bulk.json`:

```json
{
  "richMenuId": "__RM__",
  "userIds": ["__U1__", "__U2__"]
}
```

`__RM__` / `__U1__` / `__U2__` placeholders will be replaced at runtime by the test.

- [ ] **Step 4: Commit**

```bash
git add test/integration/testdata/
git commit -m "test(line-cli-go): add richmenu integration testdata"
```

---

## Task 20: Integration test — Lifecycle + Validate

**Files:**
- Create: `line-cli-go/test/integration/richmenu_test.go`

- [ ] **Step 1: Create richmenu_test.go**

Create `line-cli-go/test/integration/richmenu_test.go`:

```go
package integration

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestRichMenuValidate runs `richmenu validate` in isolation (no side-effects on the mock).
func TestRichMenuValidate(t *testing.T) {
	token := os.Getenv("TEST_ACCESS_TOKEN")
	if token == "" {
		t.Skip("TEST_ACCESS_TOKEN required")
	}

	rmPath := filepath.Join("testdata", "rm.json")
	out, errOut, err := runCLI(t, "--access-token", token,
		"richmenu", "validate", "--payload-file", rmPath)
	if err != nil {
		t.Fatalf("validate failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, "Rich menu payload valid") && !strings.Contains(out, "message") {
		t.Errorf("validate output missing success marker: %s", out)
	}
}

// TestRichMenuLifecycle exercises all 14 remaining PR-1 commands end-to-end.
func TestRichMenuLifecycle(t *testing.T) {
	token := os.Getenv("TEST_ACCESS_TOKEN")
	userID := os.Getenv("TEST_USER_ID")
	if token == "" || userID == "" {
		t.Skip("TEST_ACCESS_TOKEN and TEST_USER_ID required")
	}

	// 1. create
	out, errOut, err := runCLI(t, "--access-token", token,
		"richmenu", "create", "--payload-file", filepath.Join("testdata", "rm.json"))
	if err != nil {
		t.Fatalf("create failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	var createResp struct {
		RichMenuId string `json:"richMenuId"`
	}
	if err := json.Unmarshal([]byte(out), &createResp); err != nil {
		t.Fatalf("parse create response: %v\nstdout: %s", err, out)
	}
	rmID := createResp.RichMenuId
	if rmID == "" {
		t.Fatalf("empty richMenuId in create response: %s", out)
	}
	t.Logf("created rich menu: %s", rmID)

	// Ensure cleanup regardless of later failures.
	t.Cleanup(func() {
		runCLI(t, "--access-token", token, "richmenu", "delete", "--rich-menu-id", rmID)
	})

	// 2. get
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "get", "--rich-menu-id", rmID)
	if err != nil {
		t.Fatalf("get failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, rmID) {
		t.Errorf("get response missing richMenuId: %s", out)
	}

	// 3. list (should contain this RM)
	out, errOut, err = runCLI(t, "--access-token", token, "richmenu", "list")
	if err != nil {
		t.Fatalf("list failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, rmID) {
		t.Errorf("list missing richMenuId %s: %s", rmID, out)
	}

	// 4. set-image
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "set-image",
		"--rich-menu-id", rmID,
		"--image", filepath.Join("testdata", "rm.png"))
	if err != nil {
		t.Fatalf("set-image failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// 5. get-image
	outFile := filepath.Join(t.TempDir(), "rm_out.png")
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "get-image",
		"--rich-menu-id", rmID,
		"--output", outFile)
	if err != nil {
		t.Fatalf("get-image failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	info, err := os.Stat(outFile)
	if err != nil || info.Size() == 0 {
		t.Errorf("get-image produced empty file: %v size=%d", err, info.Size())
	}

	// 6. set-default
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "set-default", "--rich-menu-id", rmID)
	if err != nil {
		t.Fatalf("set-default failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// 7. get-default
	out, errOut, err = runCLI(t, "--access-token", token, "richmenu", "get-default")
	if err != nil {
		t.Fatalf("get-default failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, rmID) {
		t.Errorf("get-default missing richMenuId: %s", out)
	}

	// 8. cancel-default
	out, errOut, err = runCLI(t, "--access-token", token, "richmenu", "cancel-default")
	if err != nil {
		t.Fatalf("cancel-default failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// 9. link
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "link", "--user-id", userID, "--rich-menu-id", rmID)
	if err != nil {
		t.Fatalf("link failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// 10. get-for-user
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "get-for-user", "--user-id", userID)
	if err != nil {
		t.Fatalf("get-for-user failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, rmID) {
		t.Errorf("get-for-user missing richMenuId: %s", out)
	}

	// 11. unlink
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "unlink", "--user-id", userID)
	if err != nil {
		t.Fatalf("unlink failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// 12. bulk-link (with the same user, single-element array — LINE accepts 1-500)
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "bulk-link",
		"--rich-menu-id", rmID,
		"--user-ids", userID)
	if err != nil {
		t.Fatalf("bulk-link failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// 13. bulk-unlink
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "bulk-unlink",
		"--user-ids", userID)
	if err != nil {
		t.Fatalf("bulk-unlink failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// 14. delete happens via t.Cleanup registered above.
}
```

- [ ] **Step 2: Run unit tests (integration will skip without env vars)**

```bash
go test ./... -v
```

Expected: all unit tests (`internal/payload/...`, `internal/output/...`, `internal/config/...`) pass. Integration tests Skip without env vars.

- [ ] **Step 3: Run integration tests against mock (manual, optional)**

Start mock in another terminal:

```bash
cd ../line-api-mock && bun run dev
```

Export env vars and run:

```bash
export LINE_BASE_URL=http://localhost:3000
export TEST_ACCESS_TOKEN=<valid mock token>
export TEST_USER_ID=U1234567890abcdef1234567890abcdef
go test ./test/integration/... -v -run RichMenu
```

Expected: both `TestRichMenuValidate` and `TestRichMenuLifecycle` PASS.

If any step fails, debug the failing command directly (run the CLI manually) and fix before moving on.

- [ ] **Step 4: Commit**

```bash
git add test/integration/richmenu_test.go
git commit -m "test(line-cli-go): richmenu lifecycle + validate integration"
```

---

## Task 21: README Update

**Files:**
- Modify: `line-cli-go/README.md`

- [ ] **Step 1: Add richmenu section**

In `line-cli-go/README.md`, locate the existing command reference section (following the pattern of `message` / `content` / etc.) and add a new `## richmenu` section after the last existing group (or wherever groups are ordered — match the repo style).

Add:

````markdown
## richmenu

Rich Menu CRUD, image upload/download, default assignment, and user linking.

### Create / Inspect

```bash
# Create from a JSON payload
line-cli-go richmenu create --payload-file rm.json

# Validate without creating (dry-run)
line-cli-go richmenu validate --payload-file rm.json

# List all
line-cli-go richmenu list --json

# Get one
line-cli-go richmenu get --rich-menu-id RM123
```

### Image

```bash
# Upload PNG (detects content-type by extension)
line-cli-go richmenu set-image --rich-menu-id RM123 --image menu.png

# Upload from stdin (detects via http.DetectContentType)
curl -s https://example.com/menu.png | \
  line-cli-go richmenu set-image --rich-menu-id RM123 --image -

# Download to file
line-cli-go richmenu get-image --rich-menu-id RM123 --output out.png

# Download to stdout
line-cli-go richmenu get-image --rich-menu-id RM123 > out.png
```

### Default Rich Menu

```bash
line-cli-go richmenu set-default --rich-menu-id RM123
line-cli-go richmenu get-default --json
line-cli-go richmenu cancel-default
```

### User Linking

```bash
# Single user
line-cli-go richmenu link --user-id U123 --rich-menu-id RM123
line-cli-go richmenu get-for-user --user-id U123 --json
line-cli-go richmenu unlink --user-id U123

# Bulk (1-500 users per call)
line-cli-go richmenu bulk-link --rich-menu-id RM123 --user-ids U1,U2,U3
line-cli-go richmenu bulk-unlink --user-ids U1,U2,U3

# Alternative: full payload file
line-cli-go richmenu bulk-link --payload-file bulk.json
```

### Minimal End-to-End

```bash
# 1. Create
ID=$(line-cli-go richmenu create --payload-file rm.json --json | jq -r .richMenuId)

# 2. Upload image
line-cli-go richmenu set-image --rich-menu-id "$ID" --image menu.png

# 3. Set as default
line-cli-go richmenu set-default --rich-menu-id "$ID"
```
````

- [ ] **Step 2: Update integration test env var section**

If the README documents integration test env vars, append richmenu's requirements. Otherwise add this short subsection near other test instructions:

```markdown
### Rich Menu integration tests

Require `TEST_ACCESS_TOKEN` and `TEST_USER_ID`. Skipped without them.

```bash
export LINE_BASE_URL=http://localhost:3000
export TEST_ACCESS_TOKEN=...
export TEST_USER_ID=U...
go test ./test/integration/... -v -run RichMenu
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(line-cli-go): document richmenu commands in README"
```

---

## Task 22: Update Existing Design Doc — Scope Status

**Files:**
- Modify: `docs/superpowers/specs/2026-04-18-line-cli-go-design.md`

This removes `Rich Menu` from the spec's "スコープ外" list since PR-1 now implements it (alias/batch still in PR-2 but core is in). Don't fully remove the note — annotate partial status.

- [ ] **Step 1: Update the "スコープ外" section**

In `docs/superpowers/specs/2026-04-18-line-cli-go-design.md`, locate the "スコープ外" section (at/near the end of the file). Find the line mentioning Rich Menu.

It currently reads (from the spec Task 3 exploration earlier in brainstorming):

```
- 未実装エンドポイント (Rich Menu, LIFF, Insight, Audience 等)
```

Change it to:

```
- 未実装エンドポイント (LIFF, Insight, Audience 等) — Rich Menu は別 spec (`2026-04-21-line-cli-go-richmenu-design.md`) で PR-1 (core + linking) 実装済み / PR-2 (alias + batch) 予定
```

- [ ] **Step 2: Commit**

```bash
# working dir is line-cli-go, but the target file is in the repo root docs/
cd ..
git add docs/superpowers/specs/2026-04-18-line-cli-go-design.md
git commit -m "docs(line-cli-go): note Rich Menu PR-1 in existing design spec"
cd line-cli-go
```

---

## Task 23: Final Verification

**No file changes in this task — just sanity checks before opening PR.**

- [ ] **Step 1: Run full build and unit test suite**

```bash
cd line-cli-go
go build ./...
go vet ./...
go test ./...
```

Expected: clean build, no vet issues, all unit tests PASS, integration skipped.

- [ ] **Step 2: Verify subcommand tree**

```bash
./line-cli-go richmenu --help
```

Expected: lists all 15 subcommands (`cancel-default`, `bulk-link`, `bulk-unlink`, `create`, `delete`, `get`, `get-default`, `get-for-user`, `get-image`, `link`, `list`, `set-default`, `set-image`, `unlink`, `validate`).

- [ ] **Step 3: Run integration lifecycle against running mock**

(If mock is not already running, start it: `cd ../line-api-mock && bun run dev`.)

```bash
export LINE_BASE_URL=http://localhost:3000
export TEST_ACCESS_TOKEN=<valid mock token>
export TEST_USER_ID=U1234567890abcdef1234567890abcdef
go test ./test/integration/... -v -run RichMenu
```

Expected: both `TestRichMenuValidate` and `TestRichMenuLifecycle` PASS.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feat/line-cli-go-richmenu
gh pr create --title "feat(line-cli-go): Rich Menu core + linking (PR-1)" --body "$(cat <<'EOF'
## Summary

- Adds 15 Rich Menu endpoints (core CRUD + image + default + linking) as cobra subcommands under `line-cli-go richmenu ...`
- New `internal/payload/` helper for `--payload-file` / `--image` parsing (unit-tested)
- Integration tests (skip without `TEST_ACCESS_TOKEN` / `TEST_USER_ID`)
- Alias + batch are deferred to PR-2

## Test plan

- [ ] `go test ./...` (unit) passes
- [ ] `go build ./...` clean
- [ ] Manual integration run against running line-api-mock: `TestRichMenuLifecycle` and `TestRichMenuValidate` PASS

Spec: `docs/superpowers/specs/2026-04-21-line-cli-go-richmenu-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL is printed.
