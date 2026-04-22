# line-cli-go: Rich Menu Alias + Batch (PR-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the remaining 8 LINE Messaging API Rich Menu endpoints (5 alias + 3 batch-async) as cobra subcommands under `line-cli-go richmenu alias …` and `line-cli-go richmenu batch …`. Completes the Rich Menu CLI surface (23/23 endpoints) started in PR-1.

**Architecture:** Two new sub-packages under `cmd/richmenu/`: `alias/` (5 files + group root) and `batch/` (3 files + group root). Each subpackage imports `cmd/richmenu` to attach its group (`AliasCmd` / `BatchCmd`) onto `RichMenuCmd`. `cmd/root.go` blank-imports both sub-packages so their `init()`s run. `internal/payload/` (from PR-1) is reused as-is. The only novel code path is `batch submit`, which must use `RichMenuBatchWithHttpInfo` to extract the `X-Line-Request-Id` response header (the 202 body is empty).

**Tech Stack:** Go 1.26, cobra, `github.com/line/line-bot-sdk-go/v8`.

**Branch:** `feat/line-cli-go-richmenu-alias-batch` (stacked on `feat/line-cli-go-richmenu`; rebase onto `main` after PR-1 merges).

**Spec reference:** `docs/superpowers/specs/2026-04-21-line-cli-go-richmenu-design.md` (PR-2 section).

---

## File Structure

**New files:**
- `line-cli-go/cmd/richmenu/alias/alias.go` — `AliasCmd` group, registers on `richmenu.RichMenuCmd`
- `line-cli-go/cmd/richmenu/alias/create.go`
- `line-cli-go/cmd/richmenu/alias/list.go`
- `line-cli-go/cmd/richmenu/alias/get.go`
- `line-cli-go/cmd/richmenu/alias/update.go`
- `line-cli-go/cmd/richmenu/alias/delete.go`
- `line-cli-go/cmd/richmenu/batch/batch.go` — `BatchCmd` group
- `line-cli-go/cmd/richmenu/batch/submit.go`
- `line-cli-go/cmd/richmenu/batch/progress.go`
- `line-cli-go/cmd/richmenu/batch/validate.go`
- `line-cli-go/test/integration/richmenu_alias_test.go`
- `line-cli-go/test/integration/richmenu_batch_test.go`
- `line-cli-go/test/integration/testdata/batch_ops.json`

**Modified files:**
- `line-cli-go/cmd/root.go` — add two blank imports for side-effect registration
- `line-cli-go/README.md` — add alias + batch subcommands table rows and usage snippets
- `docs/superpowers/specs/2026-04-18-line-cli-go-design.md` — finalize status note (all Rich Menu now implemented)

---

## Endpoint ↔ SDK Mapping

All signatures verified against `line-bot-sdk-go/v8@v8.20.0/linebot/messaging_api`:

| CLI | HTTP | SDK method | Notes |
|---|---|---|---|
| `richmenu alias create --payload-file` | POST `/v2/bot/richmenu/alias` | `CreateRichMenuAlias(*CreateRichMenuAliasRequest)` | Body: `{richMenuAliasId, richMenuId}` |
| `richmenu alias list` | GET `/v2/bot/richmenu/alias/list` | `GetRichMenuAliasList()` | Returns `*RichMenuAliasListResponse` |
| `richmenu alias get --alias-id` | GET `/v2/bot/richmenu/alias/:aliasId` | `GetRichMenuAlias(aliasId)` | Returns `*RichMenuAliasResponse` |
| `richmenu alias update --alias-id --rich-menu-id` | POST `/v2/bot/richmenu/alias/:aliasId` | `UpdateRichMenuAlias(aliasId, *UpdateRichMenuAliasRequest)` | Body: `{richMenuId}` |
| `richmenu alias delete --alias-id` | DELETE `/v2/bot/richmenu/alias/:aliasId` | `DeleteRichMenuAlias(aliasId)` |
| `richmenu batch validate --payload-file` | POST `/v2/bot/richmenu/validate/batch` | `ValidateRichMenuBatchRequest(*RichMenuBatchRequest)` | Body: `{operations:[…]}` |
| `richmenu batch submit --payload-file` | POST `/v2/bot/richmenu/batch` | `RichMenuBatchWithHttpInfo(*RichMenuBatchRequest)` → `(*http.Response, struct{}, error)` | Must use WithHttpInfo to read `X-Line-Request-Id` header (body empty, 202) |
| `richmenu batch progress --request-id` | GET `/v2/bot/richmenu/progress/batch` | `GetRichMenuBatchProgress(requestId)` | Returns `*RichMenuBatchProgressResponse` |

### Simplified alias create flags (additional)

`alias create` accepts either:
- `--payload-file bulk.json` (full body)
- `--alias-id A --rich-menu-id RM` (individual flags — more convenient for interactive use)

If both are specified, flag values override the payload fields when non-empty — same convention as PR-1's `bulk-link`. This diverges slightly from the spec (which only showed `--alias-id / --rich-menu-id`) but applies the PR-1 precedent consistently. The spec's bullet in section "設計判断サマリー" row "JSON 入力方式" says `--payload-file` is the uniform approach for all payload commands; allowing inline flags is a convenience, not a replacement.

### `RichMenuBatchRequest` polymorphism note

`RichMenuBatchRequest.Operations []RichMenuBatchOperationInterface` has a custom `UnmarshalJSON` that dispatches on the `type` discriminator (`"link"` / `"unlink"` / `"unlinkAll"`). PR-1's `DisallowUnknownFields` does NOT propagate to custom UnmarshalJSON, so batch payloads won't catch typos at the operation level — that layer is validated server-side only. This is an SDK limitation, not a bug in this implementation.

---

## Sub-Package Registration Mechanism

`cmd/richmenu/alias/alias.go` and `cmd/richmenu/batch/batch.go` each define a `Cmd` variable and register it on `richmenu.RichMenuCmd` in their package `init()`. For these `init()`s to run, their packages must be imported somewhere in the build — accomplished via blank imports in `cmd/root.go`:

```go
import (
    "line-cli-go/cmd/richmenu"
    _ "line-cli-go/cmd/richmenu/alias" // registers alias subgroup
    _ "line-cli-go/cmd/richmenu/batch" // registers batch subgroup
)
```

Go's guaranteed initialization order (imports before own init) means `richmenu.RichMenuCmd` is constructed before `alias.init()` runs → no nil-receiver hazard.

---

## Task 1: `cmd/richmenu/alias/alias.go` Group Scaffold + Registration

**Files:**
- Create: `line-cli-go/cmd/richmenu/alias/alias.go`
- Modify: `line-cli-go/cmd/root.go`

- [ ] **Step 1: Create the group file**

`line-cli-go/cmd/richmenu/alias/alias.go`:

```go
package alias

import (
	"line-cli-go/cmd/richmenu"

	"github.com/spf13/cobra"
)

// AliasCmd is the root of the `richmenu alias` subcommand group.
var AliasCmd = &cobra.Command{
	Use:   "alias",
	Short: "Rich Menu alias CRUD",
}

func init() {
	richmenu.RichMenuCmd.AddCommand(AliasCmd)
}
```

- [ ] **Step 2: Blank-import in root.go**

In `line-cli-go/cmd/root.go`, within the existing import block (the one that already has `"line-cli-go/cmd/richmenu"`), add:

```go
_ "line-cli-go/cmd/richmenu/alias" // registers alias subgroup
```

Place it immediately after the `"line-cli-go/cmd/richmenu"` line for grouping. Leave an explanatory trailing comment.

- [ ] **Step 3: Build and smoke test**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build ./... && ./line-cli-go richmenu alias --help
```

Expected output includes:
```
Usage:
  line-cli-go richmenu alias [command]
```

With no subcommands yet.

- [ ] **Step 4: Commit**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
git add line-cli-go/cmd/richmenu/alias/alias.go line-cli-go/cmd/root.go
git commit -m "feat(line-cli-go): add richmenu alias subcommand group scaffold"
```

---

## Task 2: `richmenu alias create`

**Files:**
- Create: `line-cli-go/cmd/richmenu/alias/create.go`

Supports:
- `--payload-file` (full `CreateRichMenuAliasRequest` body), and/or
- `--alias-id` + `--rich-menu-id` (inline flags that override payload fields when non-empty)

- [ ] **Step 1: Create the file**

```go
package alias

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
	Short: "Create a rich menu alias",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		aliasID, _ := cmd.Flags().GetString("alias-id")
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")

		var req messaging_api.CreateRichMenuAliasRequest
		if payloadFile != "" {
			if err := payload.LoadJSON(payloadFile, &req); err != nil {
				return err
			}
		}
		if aliasID != "" {
			req.RichMenuAliasId = aliasID
		}
		if richMenuID != "" {
			req.RichMenuId = richMenuID
		}
		if req.RichMenuAliasId == "" {
			return &config.ClientError{Msg: "--alias-id (or payload richMenuAliasId) is required"}
		}
		if req.RichMenuId == "" {
			return &config.ClientError{Msg: "--rich-menu-id (or payload richMenuId) is required"}
		}

		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.CreateRichMenuAlias(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu alias created", map[string]string{
			"richMenuAliasId": req.RichMenuAliasId,
			"richMenuId":      req.RichMenuId,
		})
		return nil
	},
}

func init() {
	createCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin)")
	createCmd.Flags().String("alias-id", "", "alias ID (overrides payload)")
	createCmd.Flags().String("rich-menu-id", "", "rich menu ID (overrides payload)")
	AliasCmd.AddCommand(createCmd)
}
```

- [ ] **Step 2: Build**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build ./...
```

- [ ] **Step 3: Commit**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
git add line-cli-go/cmd/richmenu/alias/create.go
git commit -m "feat(line-cli-go): add richmenu alias create"
```

---

## Task 3: `richmenu alias list`

**Files:**
- Create: `line-cli-go/cmd/richmenu/alias/list.go`

- [ ] **Step 1: Create the file**

```go
package alias

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List all rich menu aliases",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenuAliasList()
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	AliasCmd.AddCommand(listCmd)
}
```

- [ ] **Step 2: Build**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add line-cli-go/cmd/richmenu/alias/list.go
git commit -m "feat(line-cli-go): add richmenu alias list"
```

---

## Task 4: `richmenu alias get`

**Files:**
- Create: `line-cli-go/cmd/richmenu/alias/get.go`

- [ ] **Step 1: Create the file**

```go
package alias

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get a rich menu alias by ID",
	RunE: func(cmd *cobra.Command, args []string) error {
		aliasID, _ := cmd.Flags().GetString("alias-id")
		if aliasID == "" {
			return &config.ClientError{Msg: "--alias-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenuAlias(aliasID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	getCmd.Flags().String("alias-id", "", "alias ID (required)")
	AliasCmd.AddCommand(getCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add line-cli-go/cmd/richmenu/alias/get.go
git commit -m "feat(line-cli-go): add richmenu alias get"
```

---

## Task 5: `richmenu alias update`

**Files:**
- Create: `line-cli-go/cmd/richmenu/alias/update.go`

- [ ] **Step 1: Create the file**

```go
package alias

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the rich menu ID an alias points to",
	RunE: func(cmd *cobra.Command, args []string) error {
		aliasID, _ := cmd.Flags().GetString("alias-id")
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		if aliasID == "" {
			return &config.ClientError{Msg: "--alias-id is required"}
		}
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		req := messaging_api.UpdateRichMenuAliasRequest{RichMenuId: richMenuID}
		if _, err := api.UpdateRichMenuAlias(aliasID, &req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu alias updated", map[string]string{
			"richMenuAliasId": aliasID,
			"richMenuId":      richMenuID,
		})
		return nil
	},
}

func init() {
	updateCmd.Flags().String("alias-id", "", "alias ID (required)")
	updateCmd.Flags().String("rich-menu-id", "", "new rich menu ID (required)")
	AliasCmd.AddCommand(updateCmd)
}
```

Note: `update` takes the alias ID in the path, so no payload-file variant here — the only mutable field is `richMenuId`, directly as a flag.

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add line-cli-go/cmd/richmenu/alias/update.go
git commit -m "feat(line-cli-go): add richmenu alias update"
```

---

## Task 6: `richmenu alias delete`

**Files:**
- Create: `line-cli-go/cmd/richmenu/alias/delete.go`

- [ ] **Step 1: Create the file**

```go
package alias

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var deleteCmd = &cobra.Command{
	Use:   "delete",
	Short: "Delete a rich menu alias",
	RunE: func(cmd *cobra.Command, args []string) error {
		aliasID, _ := cmd.Flags().GetString("alias-id")
		if aliasID == "" {
			return &config.ClientError{Msg: "--alias-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.DeleteRichMenuAlias(aliasID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu alias deleted", map[string]string{"richMenuAliasId": aliasID})
		return nil
	},
}

func init() {
	deleteCmd.Flags().String("alias-id", "", "alias ID (required)")
	AliasCmd.AddCommand(deleteCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Verify help lists all 5 alias subcommands**

```bash
./line-cli-go richmenu alias --help
```

Expected `Available Commands:` section lists: `create`, `delete`, `get`, `list`, `update`.

- [ ] **Step 4: Commit**

```bash
git add line-cli-go/cmd/richmenu/alias/delete.go
git commit -m "feat(line-cli-go): add richmenu alias delete"
```

---

## Task 7: `cmd/richmenu/batch/batch.go` Group Scaffold + Registration

**Files:**
- Create: `line-cli-go/cmd/richmenu/batch/batch.go`
- Modify: `line-cli-go/cmd/root.go`

- [ ] **Step 1: Create the group file**

`line-cli-go/cmd/richmenu/batch/batch.go`:

```go
package batch

import (
	"line-cli-go/cmd/richmenu"

	"github.com/spf13/cobra"
)

// BatchCmd is the root of the `richmenu batch` subcommand group.
var BatchCmd = &cobra.Command{
	Use:   "batch",
	Short: "Rich Menu batch async operations",
}

func init() {
	richmenu.RichMenuCmd.AddCommand(BatchCmd)
}
```

- [ ] **Step 2: Blank-import in root.go**

Add (immediately after the alias blank import):

```go
_ "line-cli-go/cmd/richmenu/batch" // registers batch subgroup
```

- [ ] **Step 3: Build and smoke test**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build ./... && ./line-cli-go richmenu batch --help
```

Expected: `Usage: line-cli-go richmenu batch [command]`, no subcommands yet.

- [ ] **Step 4: Commit**

```bash
git add line-cli-go/cmd/richmenu/batch/batch.go line-cli-go/cmd/root.go
git commit -m "feat(line-cli-go): add richmenu batch subcommand group scaffold"
```

---

## Task 8: `richmenu batch validate`

**Files:**
- Create: `line-cli-go/cmd/richmenu/batch/validate.go`

- [ ] **Step 1: Create the file**

```go
package batch

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
	Short: "Validate a batch operations payload without executing it",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		var req messaging_api.RichMenuBatchRequest
		if err := payload.LoadJSON(payloadFile, &req); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.ValidateRichMenuBatchRequest(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Batch payload valid", nil)
		return nil
	},
}

func init() {
	validateCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin) (required)")
	BatchCmd.AddCommand(validateCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add line-cli-go/cmd/richmenu/batch/validate.go
git commit -m "feat(line-cli-go): add richmenu batch validate"
```

---

## Task 9: `richmenu batch submit`

**Files:**
- Create: `line-cli-go/cmd/richmenu/batch/submit.go`

Uses `RichMenuBatchWithHttpInfo` to access the `X-Line-Request-Id` header — `RichMenuBatch` alone returns only an empty `struct{}` body (the 202 has no JSON content).

- [ ] **Step 1: Create the file**

```go
package batch

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var submitCmd = &cobra.Command{
	Use:   "submit",
	Short: "Submit a batch operations request (202 async)",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		var req messaging_api.RichMenuBatchRequest
		if err := payload.LoadJSON(payloadFile, &req); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		httpResp, _, err := api.RichMenuBatchWithHttpInfo(&req)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		requestID := httpResp.Header.Get("X-Line-Request-Id")
		p.Raw(map[string]any{"requestId": requestID})
		return nil
	},
}

func init() {
	submitCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin) (required)")
	BatchCmd.AddCommand(submitCmd)
}
```

- [ ] **Step 2: Build**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add line-cli-go/cmd/richmenu/batch/submit.go
git commit -m "feat(line-cli-go): add richmenu batch submit"
```

---

## Task 10: `richmenu batch progress`

**Files:**
- Create: `line-cli-go/cmd/richmenu/batch/progress.go`

- [ ] **Step 1: Create the file**

```go
package batch

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var progressCmd = &cobra.Command{
	Use:   "progress",
	Short: "Get batch request progress (single-shot, not polling)",
	RunE: func(cmd *cobra.Command, args []string) error {
		requestID, _ := cmd.Flags().GetString("request-id")
		if requestID == "" {
			return &config.ClientError{Msg: "--request-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenuBatchProgress(requestID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	progressCmd.Flags().String("request-id", "", "batch request ID from `submit` (required)")
	BatchCmd.AddCommand(progressCmd)
}
```

- [ ] **Step 2: Build + verify help**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build ./... && ./line-cli-go richmenu batch --help && ./line-cli-go richmenu --help
```

Expected: `richmenu batch` help shows `progress`, `submit`, `validate`. `richmenu` help shows `alias` and `batch` subgroups alongside the 15 existing commands.

- [ ] **Step 3: Commit**

```bash
git add line-cli-go/cmd/richmenu/batch/progress.go
git commit -m "feat(line-cli-go): add richmenu batch progress"
```

---

## Task 11: Integration testdata — `batch_ops.json`

**Files:**
- Create: `line-cli-go/test/integration/testdata/batch_ops.json`

- [ ] **Step 1: Create template**

```json
{
  "operations": [
    {
      "type": "link",
      "from": "",
      "to": "__RM__"
    }
  ]
}
```

`__RM__` is substituted at runtime by the integration test.

- [ ] **Step 2: Commit**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
git add line-cli-go/test/integration/testdata/batch_ops.json
git commit -m "test(line-cli-go): add richmenu batch_ops testdata"
```

---

## Task 12: Integration test — Alias lifecycle

**Files:**
- Create: `line-cli-go/test/integration/richmenu_alias_test.go`

- [ ] **Step 1: Create the file**

```go
package integration

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestRichMenuAliasLifecycle exercises the 5 alias commands in one flow.
func TestRichMenuAliasLifecycle(t *testing.T) {
	token := os.Getenv("TEST_ACCESS_TOKEN")
	if token == "" {
		t.Skip("TEST_ACCESS_TOKEN required")
	}

	// Create two rich menus to test alias create and update.
	createRM := func(label string) string {
		out, errOut, err := runCLI(t, "--access-token", token,
			"richmenu", "create", "--payload-file", filepath.Join("testdata", "rm.json"))
		if err != nil {
			t.Fatalf("create (%s) failed: %s\nstdout: %s\nstderr: %s", label, err, out, errOut)
		}
		var r struct {
			RichMenuId string `json:"richMenuId"`
		}
		if err := json.Unmarshal([]byte(out), &r); err != nil {
			t.Fatalf("parse create (%s): %v\n%s", label, err, out)
		}
		return r.RichMenuId
	}

	rm1 := createRM("rm1")
	rm2 := createRM("rm2")
	aliasID := fmt.Sprintf("test-alias-%d", time.Now().UnixNano())

	t.Cleanup(func() {
		runCLI(t, "--access-token", token, "richmenu", "alias", "delete", "--alias-id", aliasID)
		runCLI(t, "--access-token", token, "richmenu", "delete", "--rich-menu-id", rm1)
		runCLI(t, "--access-token", token, "richmenu", "delete", "--rich-menu-id", rm2)
	})

	// 1. alias create (via flags)
	out, errOut, err := runCLI(t, "--access-token", token,
		"richmenu", "alias", "create",
		"--alias-id", aliasID,
		"--rich-menu-id", rm1)
	if err != nil {
		t.Fatalf("alias create failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// 2. alias list (must contain aliasID)
	out, errOut, err = runCLI(t, "--access-token", token, "richmenu", "alias", "list")
	if err != nil {
		t.Fatalf("alias list failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, aliasID) {
		t.Errorf("alias list missing %s: %s", aliasID, out)
	}

	// 3. alias get
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "alias", "get", "--alias-id", aliasID)
	if err != nil {
		t.Fatalf("alias get failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, rm1) {
		t.Errorf("alias get points to wrong rich menu (want %s): %s", rm1, out)
	}

	// 4. alias update (rm1 → rm2)
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "alias", "update",
		"--alias-id", aliasID,
		"--rich-menu-id", rm2)
	if err != nil {
		t.Fatalf("alias update failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}

	// Verify update landed.
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "alias", "get", "--alias-id", aliasID)
	if err != nil {
		t.Fatalf("alias get (post-update) failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, rm2) {
		t.Errorf("alias get still points to %s after update to %s: %s", rm1, rm2, out)
	}

	// 5. alias delete happens via t.Cleanup.
}
```

- [ ] **Step 2: Verify unit tests still pass, integration compiles and skips**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go test ./... -v
```

Expected: unit tests PASS, `TestRichMenuAliasLifecycle` SKIP (no env vars).

- [ ] **Step 3: Commit**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
git add line-cli-go/test/integration/richmenu_alias_test.go
git commit -m "test(line-cli-go): richmenu alias lifecycle integration"
```

---

## Task 13: Integration test — Batch lifecycle

**Files:**
- Create: `line-cli-go/test/integration/richmenu_batch_test.go`

- [ ] **Step 1: Create the file**

```go
package integration

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestRichMenuBatchLifecycle exercises batch validate, submit, and progress.
func TestRichMenuBatchLifecycle(t *testing.T) {
	token := os.Getenv("TEST_ACCESS_TOKEN")
	if token == "" {
		t.Skip("TEST_ACCESS_TOKEN required")
	}

	// Create a rich menu we can reference in batch operations.
	out, errOut, err := runCLI(t, "--access-token", token,
		"richmenu", "create", "--payload-file", filepath.Join("testdata", "rm.json"))
	if err != nil {
		t.Fatalf("create failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	var createResp struct {
		RichMenuId string `json:"richMenuId"`
	}
	if err := json.Unmarshal([]byte(out), &createResp); err != nil {
		t.Fatalf("parse create: %v\n%s", err, out)
	}
	rmID := createResp.RichMenuId
	t.Cleanup(func() {
		runCLI(t, "--access-token", token, "richmenu", "delete", "--rich-menu-id", rmID)
	})

	// Substitute __RM__ in the testdata template.
	raw, err := os.ReadFile(filepath.Join("testdata", "batch_ops.json"))
	if err != nil {
		t.Fatalf("read batch_ops.json: %v", err)
	}
	opsBody := strings.ReplaceAll(string(raw), "__RM__", rmID)
	opsFile := filepath.Join(t.TempDir(), "batch_ops.json")
	if err := os.WriteFile(opsFile, []byte(opsBody), 0o644); err != nil {
		t.Fatalf("write substituted batch_ops.json: %v", err)
	}

	// 1. batch validate
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "batch", "validate", "--payload-file", opsFile)
	if err != nil {
		t.Fatalf("batch validate failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, "Batch payload valid") {
		t.Errorf("batch validate missing success marker: %s", out)
	}

	// 2. batch submit
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "batch", "submit", "--payload-file", opsFile)
	if err != nil {
		t.Fatalf("batch submit failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	var submitResp struct {
		RequestId string `json:"requestId"`
	}
	if err := json.Unmarshal([]byte(out), &submitResp); err != nil {
		t.Fatalf("parse submit: %v\n%s", err, out)
	}
	if submitResp.RequestId == "" {
		t.Fatalf("empty requestId in submit response: %s", out)
	}

	// 3. batch progress (single-shot — mock returns succeeded immediately)
	out, errOut, err = runCLI(t, "--access-token", token,
		"richmenu", "batch", "progress", "--request-id", submitResp.RequestId)
	if err != nil {
		t.Fatalf("batch progress failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
	}
	if !strings.Contains(out, "phase") {
		t.Errorf("batch progress missing phase field: %s", out)
	}
}
```

- [ ] **Step 2: Verify build + unit tests**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go test ./... -v
```

Expected: unit tests PASS, new integration test SKIP without env vars.

- [ ] **Step 3: Commit**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
git add line-cli-go/test/integration/richmenu_batch_test.go
git commit -m "test(line-cli-go): richmenu batch lifecycle integration"
```

---

## Task 14: README Update

**Files:**
- Modify: `line-cli-go/README.md`

- [ ] **Step 1: Extend the command table**

In the command-list table (already includes 15 richmenu rows from PR-1), append these 8 rows immediately after `richmenu bulk-unlink`:

```markdown
| `richmenu alias create` | リッチメニューエイリアス作成 |
| `richmenu alias list` | エイリアス一覧 |
| `richmenu alias get` | エイリアス取得 |
| `richmenu alias update` | エイリアス更新 |
| `richmenu alias delete` | エイリアス削除 |
| `richmenu batch validate` | バッチ操作 JSON 検証 (dry-run) |
| `richmenu batch submit` | バッチ操作送信 (非同期 / request ID 返却) |
| `richmenu batch progress` | バッチ進捗取得 (単発呼び出し) |
```

- [ ] **Step 2: Append usage sections to the "リッチメニュー使用例" block**

At the end of the existing usage-examples section (after "最小エンドツーエンドフロー"), append:

````markdown

### エイリアス

```bash
# 作成 (インラインフラグ)
./line-cli-go richmenu alias create --alias-id my-alias --rich-menu-id RM123

# 作成 (payload-file)
./line-cli-go richmenu alias create --payload-file alias.json

# 一覧 / 取得
./line-cli-go --json richmenu alias list
./line-cli-go --json richmenu alias get --alias-id my-alias

# 参照先変更
./line-cli-go richmenu alias update --alias-id my-alias --rich-menu-id RM456

# 削除
./line-cli-go richmenu alias delete --alias-id my-alias
```

### バッチ操作 (非同期)

```bash
# 検証のみ
./line-cli-go richmenu batch validate --payload-file batch_ops.json

# 実行 (202 Accepted → requestId 返却)
REQ=$(./line-cli-go --json richmenu batch submit --payload-file batch_ops.json | jq -r .requestId)

# 進捗確認 (単発呼び出し; polling 要なら shell loop)
./line-cli-go --json richmenu batch progress --request-id "$REQ"
```

`batch_ops.json` の例:

```json
{
  "operations": [
    { "type": "link", "from": "", "to": "RM123" }
  ]
}
```
````

- [ ] **Step 3: Update the 統合テスト section**

The existing section mentions only `TEST_ACCESS_TOKEN` / `TEST_USER_ID`. Alias/batch tests need only `TEST_ACCESS_TOKEN`. Update the description to reflect that some richmenu tests skip with just one env var missing vs both.

Add a note at the end of the 統合テスト section:

```markdown
- `TestRichMenuLifecycle` / `TestRichMenuBulkViaPayload` — 両方の env var が必要 (ユーザーへのリンクを伴うため)
- `TestRichMenuValidate` / `TestRichMenuAliasLifecycle` / `TestRichMenuBatchLifecycle` — `TEST_ACCESS_TOKEN` のみでスキップ回避可能
```

- [ ] **Step 4: Commit**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
git add line-cli-go/README.md
git commit -m "docs(line-cli-go): document alias and batch commands in README"
```

---

## Task 15: Finalize existing design-spec status note

**Files:**
- Modify: `docs/superpowers/specs/2026-04-18-line-cli-go-design.md`

After PR-1 the note said "PR-1 (core + linking) 実装済み / PR-2 (alias + batch) 予定". Now both PRs are done.

- [ ] **Step 1: Update the "スコープ外" line**

Replace the current line:
```
- 未実装エンドポイント (LIFF, Insight, Audience 等) — Rich Menu は別 spec (`2026-04-21-line-cli-go-richmenu-design.md`) で PR-1 (core + linking) 実装済み / PR-2 (alias + batch) 予定
```

With:
```
- 未実装エンドポイント (LIFF, Insight, Audience 等) — Rich Menu は別 spec (`2026-04-21-line-cli-go-richmenu-design.md`) で全 23 endpoints 実装済み
```

- [ ] **Step 2: Commit**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
git add docs/superpowers/specs/2026-04-18-line-cli-go-design.md
git commit -m "docs(line-cli-go): mark Rich Menu fully implemented in design spec"
```

---

## Task 16: Final Verification + PR

**No file changes — verification commands only.**

- [ ] **Step 1: Full build + vet + unit tests**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build ./...
go vet ./...
go test ./...
```

Expected: clean build, no vet warnings, all unit tests PASS (including PR-1's), integration tests SKIP.

- [ ] **Step 2: Verify complete subcommand tree**

```bash
./line-cli-go richmenu --help
./line-cli-go richmenu alias --help
./line-cli-go richmenu batch --help
```

Expected:
- `richmenu --help` lists 15 verbs + `alias` + `batch` subgroups.
- `richmenu alias --help` lists `create`, `delete`, `get`, `list`, `update`.
- `richmenu batch --help` lists `progress`, `submit`, `validate`.

- [ ] **Step 3: (Manual, requires running mock) Run all integration tests**

```bash
export LINE_BASE_URL=http://localhost:3000
export TEST_ACCESS_TOKEN=<mock token>
export TEST_USER_ID=U1234567890abcdef1234567890abcdef
go test ./test/integration/... -v -run RichMenu
```

Expected: all `TestRichMenu*` tests PASS.

- [ ] **Step 4: Push branch and open PR**

Note: this branch is stacked on `feat/line-cli-go-richmenu` (PR-1). If PR-1 has already merged to main, rebase first:

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
git fetch origin main
git rebase origin/main
```

Then push and create the PR:

```bash
git push -u origin feat/line-cli-go-richmenu-alias-batch
gh pr create --title "feat(line-cli-go): Rich Menu alias + batch (PR-2)" --body "$(cat <<'EOF'
## Summary

- Adds the remaining 8 Rich Menu endpoints (5 alias CRUD + 3 batch async) as cobra subcommands under `line-cli-go richmenu alias …` and `line-cli-go richmenu batch …`
- Completes the Rich Menu CLI surface (23/23 endpoints) started in PR #38
- Reuses PR-1's `internal/payload/` helper; no new cross-cutting abstractions

## Notable implementation details

- `batch submit` uses `RichMenuBatchWithHttpInfo` to extract the `X-Line-Request-Id` response header (the 202 body is empty)
- `alias create` accepts both `--payload-file` and inline `--alias-id`/`--rich-menu-id` flags, applying the same override semantics as PR-1's `bulk-link`
- Sub-packages `cmd/richmenu/alias/` and `cmd/richmenu/batch/` register themselves via side-effect blank imports in `cmd/root.go`

## Test plan

- [ ] `go test ./...` — unit PASS, integration SKIP without env vars
- [ ] `go build ./...` — clean
- [ ] `./line-cli-go richmenu --help`, `richmenu alias --help`, `richmenu batch --help` — all subcommands listed
- [ ] With mock running: `go test ./test/integration/... -v -run RichMenu` — all pass

## Related

- Spec: `docs/superpowers/specs/2026-04-21-line-cli-go-richmenu-design.md`
- Plan: `docs/superpowers/plans/2026-04-21-line-cli-go-richmenu-alias-batch.md`
- Predecessor: PR #38 (PR-1 / core + linking)
- Mock side: all required endpoints merged in PR #26 and PR #33

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.
