# line-cli-go Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Go CLI client that exercises all implemented endpoints of line-api-mock using the official LINE Bot SDK Go v8.

**Architecture:** Cobra subcommands grouped by resource (`token`, `message`, `profile`, `webhook`, `content`, `quota`). Viper handles config priority (env < file < flag). SDK clients (`messaging_api`, `channel_access_token`, `messaging_api_blob`) are instantiated per command via a shared factory.

**Tech Stack:** Go 1.24+, `line-bot-sdk-go/v8`, `cobra`, `viper`

**Spec:** `docs/superpowers/specs/2026-04-18-line-cli-go-design.md`

---

## File Structure

```
line-cli-go/
├── main.go                          # Entry point — executes root command
├── go.mod                           # Module: line-cli-go
├── .env.example                     # Example env vars
├── .line-cli.yaml.example           # Example config file
├── README.md                        # Quick start, command reference
├── cmd/
│   ├── root.go                      # Root command, global flags, viper init
│   ├── token/
│   │   ├── token.go                 # Parent `token` command
│   │   ├── issue.go                 # token issue (v2)
│   │   ├── issue_v3.go              # token issue-v3 (JWT)
│   │   ├── verify.go                # token verify
│   │   ├── revoke.go                # token revoke
│   │   └── list_kids.go             # token list-kids
│   ├── message/
│   │   ├── message.go               # Parent `message` command
│   │   ├── push.go                  # message push
│   │   ├── reply.go                 # message reply
│   │   ├── multicast.go             # message multicast
│   │   ├── broadcast.go             # message broadcast
│   │   └── narrowcast.go            # message narrowcast
│   ├── profile/
│   │   ├── profile.go               # Parent `profile` command
│   │   └── get.go                   # profile get
│   ├── webhook/
│   │   ├── webhook.go               # Parent `webhook` command
│   │   ├── get.go                   # webhook get
│   │   ├── set.go                   # webhook set
│   │   └── test.go                  # webhook test
│   ├── content/
│   │   ├── content.go               # Parent `content` command
│   │   └── get.go                   # content get
│   └── quota/
│       ├── quota.go                 # Parent `quota` command
│       ├── get.go                   # quota get
│       └── consumption.go           # quota consumption
├── internal/
│   ├── config/
│   │   ├── config.go                # Viper-based config loading
│   │   └── config_test.go           # Unit tests for config priority
│   ├── client/
│   │   └── client.go                # SDK client factory (messaging, oauth, blob)
│   └── output/
│       ├── output.go                # Text/JSON formatter
│       └── output_test.go           # Unit tests for output formatting
└── test/
    └── integration/
        └── cli_test.go              # Integration tests against line-api-mock
```

---

### Task 1: Project Scaffold and Root Command

**Files:**
- Create: `line-cli-go/go.mod`
- Create: `line-cli-go/main.go`
- Create: `line-cli-go/cmd/root.go`

- [ ] **Step 1: Initialize Go module**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples
mkdir -p line-cli-go
cd line-cli-go
go mod init line-cli-go
go get github.com/spf13/cobra@latest
go get github.com/spf13/viper@latest
```

- [ ] **Step 2: Create main.go**

```go
// main.go
package main

import "line-cli-go/cmd"

func main() {
	cmd.Execute()
}
```

- [ ] **Step 3: Create cmd/root.go with global flags**

```go
// cmd/root.go
package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var cfgFile string

var rootCmd = &cobra.Command{
	Use:   "line-cli-go",
	Short: "LINE Messaging API CLI client for line-api-mock",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	cobra.OnInitialize(initConfig)

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default: .line-cli.yaml)")
	rootCmd.PersistentFlags().String("base-url", "", "mock server base URL")
	rootCmd.PersistentFlags().String("channel-id", "", "LINE channel ID")
	rootCmd.PersistentFlags().String("channel-secret", "", "LINE channel secret")
	rootCmd.PersistentFlags().String("access-token", "", "channel access token")
	rootCmd.PersistentFlags().Bool("json", false, "output as JSON")

	viper.BindPFlag("base_url", rootCmd.PersistentFlags().Lookup("base-url"))
	viper.BindPFlag("channel_id", rootCmd.PersistentFlags().Lookup("channel-id"))
	viper.BindPFlag("channel_secret", rootCmd.PersistentFlags().Lookup("channel-secret"))
	viper.BindPFlag("access_token", rootCmd.PersistentFlags().Lookup("access-token"))
	viper.BindPFlag("json", rootCmd.PersistentFlags().Lookup("json"))
}

func initConfig() {
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		viper.SetConfigName(".line-cli")
		viper.SetConfigType("yaml")
		viper.AddConfigPath(".")
		home, err := os.UserHomeDir()
		if err == nil {
			viper.AddConfigPath(home)
		}
	}

	viper.SetEnvPrefix("LINE")
	viper.AutomaticEnv()
	viper.SetDefault("base_url", "http://localhost:3000")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			fmt.Fprintf(os.Stderr, "Error reading config: %s\n", err)
		}
	}
}
```

- [ ] **Step 4: Build and verify help output**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build -o line-cli-go .
./line-cli-go --help
```

Expected: Help text showing `line-cli-go` with global flags `--base-url`, `--channel-id`, `--channel-secret`, `--access-token`, `--json`, `--config`.

- [ ] **Step 5: Commit**

```bash
git add line-cli-go/
git commit -m "feat(line-cli-go): scaffold project with cobra root command and viper config"
```

---

### Task 2: Output Formatter

**Files:**
- Create: `line-cli-go/internal/output/output.go`
- Create: `line-cli-go/internal/output/output_test.go`

- [ ] **Step 1: Write failing tests for output formatter**

```go
// internal/output/output_test.go
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go test ./internal/output/ -v
```

Expected: FAIL — `NewPrinter` not defined.

- [ ] **Step 3: Implement output formatter**

```go
// internal/output/output.go
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go test ./internal/output/ -v
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add line-cli-go/internal/output/
git commit -m "feat(line-cli-go): add text/JSON output formatter with tests"
```

---

### Task 3: Config Helper and Client Factory

**Files:**
- Create: `line-cli-go/internal/config/config.go`
- Create: `line-cli-go/internal/config/config_test.go`
- Create: `line-cli-go/internal/client/client.go`

- [ ] **Step 1: Write failing tests for config**

```go
// internal/config/config_test.go
package config

import (
	"testing"

	"github.com/spf13/viper"
)

func TestRequireFields_MissingChannelID(t *testing.T) {
	viper.Reset()
	viper.Set("base_url", "http://localhost:3000")
	viper.Set("channel_secret", "secret")
	err := RequireTokenFields()
	if err == nil {
		t.Fatal("expected error for missing channel_id")
	}
}

func TestRequireFields_AllPresent(t *testing.T) {
	viper.Reset()
	viper.Set("base_url", "http://localhost:3000")
	viper.Set("channel_id", "123")
	viper.Set("channel_secret", "secret")
	err := RequireTokenFields()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRequireAccessToken_Missing(t *testing.T) {
	viper.Reset()
	err := RequireAccessToken()
	if err == nil {
		t.Fatal("expected error for missing access_token")
	}
}

func TestRequireAccessToken_Present(t *testing.T) {
	viper.Reset()
	viper.Set("access_token", "tok_abc")
	err := RequireAccessToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go test ./internal/config/ -v
```

Expected: FAIL — `RequireTokenFields` not defined.

- [ ] **Step 3: Implement config helper**

```go
// internal/config/config.go
package config

import (
	"fmt"

	"github.com/spf13/viper"
)

func BaseURL() string {
	return viper.GetString("base_url")
}

func ChannelID() string {
	return viper.GetString("channel_id")
}

func ChannelSecret() string {
	return viper.GetString("channel_secret")
}

func AccessToken() string {
	return viper.GetString("access_token")
}

func JSONMode() bool {
	return viper.GetBool("json")
}

// RequireTokenFields validates that channel_id and channel_secret are set (needed for OAuth).
func RequireTokenFields() error {
	if ChannelID() == "" {
		return fmt.Errorf("channel_id is required (set LINE_CHANNEL_ID, config file, or --channel-id)")
	}
	if ChannelSecret() == "" {
		return fmt.Errorf("channel_secret is required (set LINE_CHANNEL_SECRET, config file, or --channel-secret)")
	}
	return nil
}

// RequireAccessToken validates that access_token is set (needed for API calls).
func RequireAccessToken() error {
	if AccessToken() == "" {
		return fmt.Errorf("access_token is required (set LINE_ACCESS_TOKEN, config file, or --access-token)")
	}
	return nil
}
```

- [ ] **Step 4: Run config tests**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go test ./internal/config/ -v
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Implement client factory**

```go
// internal/client/client.go
package client

import (
	"line-cli-go/internal/config"

	"github.com/line/line-bot-sdk-go/v8/linebot/channel_access_token"
	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
)

func NewMessagingAPI() (*messaging_api.MessagingApiAPI, error) {
	if err := config.RequireAccessToken(); err != nil {
		return nil, err
	}
	client, err := messaging_api.NewMessagingApiAPI(
		config.AccessToken(),
		messaging_api.WithEndpoint(config.BaseURL()),
	)
	return client, err
}

func NewMessagingBlobAPI() (*messaging_api.MessagingApiBlobAPI, error) {
	if err := config.RequireAccessToken(); err != nil {
		return nil, err
	}
	client, err := messaging_api.NewMessagingApiBlobAPI(
		config.AccessToken(),
		messaging_api.WithBlobEndpoint(config.BaseURL()),
	)
	return client, err
}

func NewChannelAccessTokenAPI() (*channel_access_token.ChannelAccessTokenAPI, error) {
	client, err := channel_access_token.NewChannelAccessTokenAPI(
		channel_access_token.WithEndpoint(config.BaseURL()),
	)
	return client, err
}
```

Note: The exact option names (`WithEndpoint`, `WithBlobEndpoint`) should be verified against the SDK source at implementation time. The SDK is OpenAPI-generated and the option names may differ slightly (e.g., `WithEndpoint` vs `WithURL`). Check `go doc` after `go get`.

- [ ] **Step 6: Install SDK dependency and verify build**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go get github.com/line/line-bot-sdk-go/v8@latest
go build ./...
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add line-cli-go/internal/config/ line-cli-go/internal/client/ line-cli-go/go.mod line-cli-go/go.sum
git commit -m "feat(line-cli-go): add config helper with tests and SDK client factory"
```

---

### Task 4: Token Commands

**Files:**
- Create: `line-cli-go/cmd/token/token.go`
- Create: `line-cli-go/cmd/token/issue.go`
- Create: `line-cli-go/cmd/token/issue_v3.go`
- Create: `line-cli-go/cmd/token/verify.go`
- Create: `line-cli-go/cmd/token/revoke.go`
- Create: `line-cli-go/cmd/token/list_kids.go`
- Modify: `line-cli-go/cmd/root.go` (register token subcommand)

- [ ] **Step 1: Create token parent command**

```go
// cmd/token/token.go
package token

import "github.com/spf13/cobra"

var TokenCmd = &cobra.Command{
	Use:   "token",
	Short: "Manage channel access tokens",
}

func init() {
	TokenCmd.AddCommand(issueCmd)
	TokenCmd.AddCommand(issueV3Cmd)
	TokenCmd.AddCommand(verifyCmd)
	TokenCmd.AddCommand(revokeCmd)
	TokenCmd.AddCommand(listKidsCmd)
}
```

- [ ] **Step 2: Implement token issue (v2)**

```go
// cmd/token/issue.go
package token

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var issueCmd = &cobra.Command{
	Use:   "issue",
	Short: "Issue a v2 channel access token (client_credentials)",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireTokenFields(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		resp, err := tokenAPI.IssueChannelToken(
			"client_credentials",
			config.ChannelID(),
			config.ChannelSecret(),
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"access_token": resp.AccessToken,
			"expires_in":   resp.ExpiresIn,
			"token_type":   resp.TokenType,
		})
		return nil
	},
}
```

- [ ] **Step 3: Implement token issue-v3 (JWT)**

```go
// cmd/token/issue_v3.go
package token

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var issueV3Cmd = &cobra.Command{
	Use:   "issue-v3",
	Short: "Issue a v2.1 channel access token (JWT-based)",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireTokenFields(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		// The mock does not verify JWT signatures, so a dummy assertion suffices.
		// In production, this would be a real JWT signed with a private key.
		assertion := "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.dummy"

		resp, err := tokenAPI.IssueChannelTokenByJWT(
			"client_credentials",
			"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			assertion,
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"access_token": resp.AccessToken,
			"expires_in":   resp.ExpiresIn,
			"token_type":   resp.TokenType,
			"key_id":       resp.KeyId,
		})
		return nil
	},
}
```

Note: The mock's `/oauth2/v2.1/token` requires `client_id` as a form field. The SDK's `IssueChannelTokenByJWT` may not send `client_id`. If this fails at integration time, fall back to a raw HTTP POST with `url.Values{"grant_type": ..., "client_id": ..., "client_assertion": ...}`.

- [ ] **Step 4: Implement token verify**

```go
// cmd/token/verify.go
package token

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var verifyCmd = &cobra.Command{
	Use:   "verify",
	Short: "Verify a channel access token",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireAccessToken(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		resp, err := tokenAPI.VerifyChannelToken(config.AccessToken())
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"client_id":  resp.ClientId,
			"expires_in": resp.ExpiresIn,
			"scope":      resp.Scope,
		})
		return nil
	},
}
```

- [ ] **Step 5: Implement token revoke**

```go
// cmd/token/revoke.go
package token

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var revokeCmd = &cobra.Command{
	Use:   "revoke",
	Short: "Revoke a channel access token",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireAccessToken(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		err = tokenAPI.RevokeChannelToken(config.AccessToken())
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Success("Token revoked", nil)
		return nil
	},
}
```

- [ ] **Step 6: Implement token list-kids**

```go
// cmd/token/list_kids.go
package token

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var listKidsCmd = &cobra.Command{
	Use:   "list-kids",
	Short: "List valid key IDs for v2.1 tokens",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireTokenFields(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		assertion := "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.dummy"
		resp, err := tokenAPI.GetsAllValidChannelAccessTokenKeyIds(
			"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			assertion,
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"kids": resp.Kids,
		})
		return nil
	},
}
```

- [ ] **Step 7: Register token command in root.go**

Add to `cmd/root.go`'s `init()`:

```go
import "line-cli-go/cmd/token"

// inside init():
rootCmd.AddCommand(token.TokenCmd)
```

- [ ] **Step 8: Build and verify**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build -o line-cli-go .
./line-cli-go token --help
```

Expected: Shows subcommands `issue`, `issue-v3`, `verify`, `revoke`, `list-kids`.

- [ ] **Step 9: Commit**

```bash
git add line-cli-go/cmd/token/ line-cli-go/cmd/root.go
git commit -m "feat(line-cli-go): add token commands (issue, issue-v3, verify, revoke, list-kids)"
```

---

### Task 5: Message Commands

**Files:**
- Create: `line-cli-go/cmd/message/message.go`
- Create: `line-cli-go/cmd/message/push.go`
- Create: `line-cli-go/cmd/message/reply.go`
- Create: `line-cli-go/cmd/message/multicast.go`
- Create: `line-cli-go/cmd/message/broadcast.go`
- Create: `line-cli-go/cmd/message/narrowcast.go`
- Modify: `line-cli-go/cmd/root.go` (register message subcommand)

- [ ] **Step 1: Create message parent command**

```go
// cmd/message/message.go
package message

import "github.com/spf13/cobra"

var MessageCmd = &cobra.Command{
	Use:   "message",
	Short: "Send messages via LINE Messaging API",
}

func init() {
	MessageCmd.AddCommand(pushCmd)
	MessageCmd.AddCommand(replyCmd)
	MessageCmd.AddCommand(multicastCmd)
	MessageCmd.AddCommand(broadcastCmd)
	MessageCmd.AddCommand(narrowcastCmd)
}
```

- [ ] **Step 2: Create helper for building messages array**

Add to `cmd/message/message.go`:

```go
import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
)

// buildMessages constructs a []messaging_api.MessageInterface from --text or --payload-file.
func buildMessages(text, payloadFile string) ([]messaging_api.MessageInterface, error) {
	if payloadFile != "" {
		data, err := os.ReadFile(payloadFile)
		if err != nil {
			return nil, fmt.Errorf("reading payload file: %w", err)
		}
		var msgs []messaging_api.MessageInterface
		if err := json.Unmarshal(data, &msgs); err != nil {
			// Try single message object
			var msg messaging_api.MessageInterface
			if err2 := json.Unmarshal(data, &msg); err2 != nil {
				return nil, fmt.Errorf("parsing payload JSON: %w", err)
			}
			return []messaging_api.MessageInterface{msg}, nil
		}
		return msgs, nil
	}
	if text == "" {
		return nil, fmt.Errorf("either --text or --payload-file is required")
	}
	return []messaging_api.MessageInterface{
		&messaging_api.TextMessage{
			Text: text,
		},
	}, nil
}
```

Note: The exact type for `TextMessage` and `MessageInterface` must be verified against the SDK at implementation time. The SDK uses OpenAPI-generated types. If `MessageInterface` is not the correct interface name, check `go doc messaging_api` for the right type.

- [ ] **Step 3: Implement message push**

```go
// cmd/message/push.go
package message

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var pushCmd = &cobra.Command{
	Use:   "push",
	Short: "Send a push message to a user",
	RunE: func(cmd *cobra.Command, args []string) error {
		to, _ := cmd.Flags().GetString("to")
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")

		if to == "" {
			return fmt.Errorf("--to is required")
		}

		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.PushMessage(
			&messaging_api.PushMessageRequest{
				To:       to,
				Messages: msgs,
			},
			"", // x-line-retry-key (optional)
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		sentIDs := make([]string, 0)
		if resp != nil && resp.SentMessages != nil {
			for _, m := range resp.SentMessages {
				sentIDs = append(sentIDs, m.Id)
			}
		}
		p.Raw(map[string]any{
			"sentMessages": sentIDs,
		})
		return nil
	},
}

func init() {
	pushCmd.Flags().String("to", "", "recipient user ID (required)")
	pushCmd.Flags().String("text", "", "text message content")
	pushCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
```

- [ ] **Step 4: Implement message reply**

```go
// cmd/message/reply.go
package message

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var replyCmd = &cobra.Command{
	Use:   "reply",
	Short: "Reply to a message using a reply token",
	RunE: func(cmd *cobra.Command, args []string) error {
		replyToken, _ := cmd.Flags().GetString("reply-token")
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")

		if replyToken == "" {
			return fmt.Errorf("--reply-token is required")
		}

		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.ReplyMessage(
			&messaging_api.ReplyMessageRequest{
				ReplyToken: replyToken,
				Messages:   msgs,
			},
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		sentIDs := make([]string, 0)
		if resp != nil && resp.SentMessages != nil {
			for _, m := range resp.SentMessages {
				sentIDs = append(sentIDs, m.Id)
			}
		}
		p.Raw(map[string]any{
			"sentMessages": sentIDs,
		})
		return nil
	},
}

func init() {
	replyCmd.Flags().String("reply-token", "", "reply token (required)")
	replyCmd.Flags().String("text", "", "text message content")
	replyCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
```

- [ ] **Step 5: Implement message multicast**

```go
// cmd/message/multicast.go
package message

import (
	"fmt"
	"os"
	"strings"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var multicastCmd = &cobra.Command{
	Use:   "multicast",
	Short: "Send a message to multiple users",
	RunE: func(cmd *cobra.Command, args []string) error {
		toStr, _ := cmd.Flags().GetString("to")
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")

		if toStr == "" {
			return fmt.Errorf("--to is required (comma-separated user IDs)")
		}
		to := strings.Split(toStr, ",")

		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		_, err = api.Multicast(
			&messaging_api.MulticastRequest{
				To:       to,
				Messages: msgs,
			},
			"",
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Success("Multicast sent", map[string]string{
			"recipients": fmt.Sprintf("%d", len(to)),
		})
		return nil
	},
}

func init() {
	multicastCmd.Flags().String("to", "", "comma-separated user IDs (required)")
	multicastCmd.Flags().String("text", "", "text message content")
	multicastCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
```

- [ ] **Step 6: Implement message broadcast**

```go
// cmd/message/broadcast.go
package message

import (
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var broadcastCmd = &cobra.Command{
	Use:   "broadcast",
	Short: "Send a message to all users",
	RunE: func(cmd *cobra.Command, args []string) error {
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")

		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		_, err = api.Broadcast(
			&messaging_api.BroadcastRequest{
				Messages: msgs,
			},
			"",
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Success("Broadcast sent", nil)
		return nil
	},
}

func init() {
	broadcastCmd.Flags().String("text", "", "text message content")
	broadcastCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
```

- [ ] **Step 7: Implement message narrowcast**

```go
// cmd/message/narrowcast.go
package message

import (
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var narrowcastCmd = &cobra.Command{
	Use:   "narrowcast",
	Short: "Send a narrowcast message (async, returns request ID)",
	RunE: func(cmd *cobra.Command, args []string) error {
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")

		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.Narrowcast(
			&messaging_api.NarrowcastRequest{
				Messages: msgs,
			},
			"",
		)
		_ = resp // narrowcast returns 202; request ID is in response header
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Success("Narrowcast accepted (202)", nil)
		return nil
	},
}

func init() {
	narrowcastCmd.Flags().String("text", "", "text message content")
	narrowcastCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
```

- [ ] **Step 8: Register message command in root.go**

Add to `cmd/root.go`:

```go
import "line-cli-go/cmd/message"

// inside init():
rootCmd.AddCommand(message.MessageCmd)
```

- [ ] **Step 9: Build and verify**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build -o line-cli-go .
./line-cli-go message --help
```

Expected: Shows subcommands `push`, `reply`, `multicast`, `broadcast`, `narrowcast`.

- [ ] **Step 10: Commit**

```bash
git add line-cli-go/cmd/message/ line-cli-go/cmd/root.go
git commit -m "feat(line-cli-go): add message commands (push, reply, multicast, broadcast, narrowcast)"
```

---

### Task 6: Profile Command

**Files:**
- Create: `line-cli-go/cmd/profile/profile.go`
- Create: `line-cli-go/cmd/profile/get.go`
- Modify: `line-cli-go/cmd/root.go`

- [ ] **Step 1: Create profile parent command**

```go
// cmd/profile/profile.go
package profile

import "github.com/spf13/cobra"

var ProfileCmd = &cobra.Command{
	Use:   "profile",
	Short: "Get user profiles",
}

func init() {
	ProfileCmd.AddCommand(getCmd)
}
```

- [ ] **Step 2: Implement profile get**

```go
// cmd/profile/get.go
package profile

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get a user's profile",
	RunE: func(cmd *cobra.Command, args []string) error {
		userID, _ := cmd.Flags().GetString("user-id")
		if userID == "" {
			return fmt.Errorf("--user-id is required")
		}

		p := output.NewPrinter(config.JSONMode(), nil)

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.GetProfile(userID)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"userId":      resp.UserId,
			"displayName": resp.DisplayName,
			"pictureUrl":  resp.PictureUrl,
			"language":    resp.Language,
		})
		return nil
	},
}

func init() {
	getCmd.Flags().String("user-id", "", "LINE user ID (required)")
}
```

- [ ] **Step 3: Register in root.go, build and verify**

Add to `cmd/root.go`:

```go
import "line-cli-go/cmd/profile"

// inside init():
rootCmd.AddCommand(profile.ProfileCmd)
```

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build -o line-cli-go .
./line-cli-go profile --help
```

Expected: Shows subcommand `get`.

- [ ] **Step 4: Commit**

```bash
git add line-cli-go/cmd/profile/ line-cli-go/cmd/root.go
git commit -m "feat(line-cli-go): add profile get command"
```

---

### Task 7: Webhook Commands

**Files:**
- Create: `line-cli-go/cmd/webhook/webhook.go`
- Create: `line-cli-go/cmd/webhook/get.go`
- Create: `line-cli-go/cmd/webhook/set.go`
- Create: `line-cli-go/cmd/webhook/test.go`
- Modify: `line-cli-go/cmd/root.go`

- [ ] **Step 1: Create webhook parent command**

```go
// cmd/webhook/webhook.go
package webhook

import "github.com/spf13/cobra"

var WebhookCmd = &cobra.Command{
	Use:   "webhook",
	Short: "Manage webhook endpoint configuration",
}

func init() {
	WebhookCmd.AddCommand(getCmd)
	WebhookCmd.AddCommand(setCmd)
	WebhookCmd.AddCommand(testCmd)
}
```

- [ ] **Step 2: Implement webhook get**

```go
// cmd/webhook/get.go
package webhook

import (
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get current webhook endpoint configuration",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.GetWebhookEndpoint()
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"endpoint": resp.Endpoint,
			"active":   resp.Active,
		})
		return nil
	},
}
```

- [ ] **Step 3: Implement webhook set**

```go
// cmd/webhook/set.go
package webhook

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var setCmd = &cobra.Command{
	Use:   "set",
	Short: "Set the webhook endpoint URL",
	RunE: func(cmd *cobra.Command, args []string) error {
		url, _ := cmd.Flags().GetString("url")
		if url == "" {
			return fmt.Errorf("--url is required")
		}

		p := output.NewPrinter(config.JSONMode(), nil)

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		err = api.SetWebhookEndpoint(
			&messaging_api.SetWebhookEndpointRequest{
				Endpoint: url,
			},
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Success("Webhook endpoint updated", map[string]string{
			"endpoint": url,
		})
		return nil
	},
}

func init() {
	setCmd.Flags().String("url", "", "webhook endpoint URL (required)")
}
```

- [ ] **Step 4: Implement webhook test**

```go
// cmd/webhook/test.go
package webhook

import (
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var testCmd = &cobra.Command{
	Use:   "test",
	Short: "Test the webhook endpoint connectivity",
	RunE: func(cmd *cobra.Command, args []string) error {
		url, _ := cmd.Flags().GetString("url")

		p := output.NewPrinter(config.JSONMode(), nil)

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		req := &messaging_api.TestWebhookEndpointRequest{}
		if url != "" {
			req.Endpoint = url
		}

		resp, err := api.TestWebhookEndpoint(req)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"success":    resp.Success,
			"timestamp":  resp.Timestamp,
			"statusCode": resp.StatusCode,
		})
		return nil
	},
}

func init() {
	testCmd.Flags().String("url", "", "webhook URL to test (optional, uses configured URL if omitted)")
}
```

- [ ] **Step 5: Register in root.go, build and verify**

Add to `cmd/root.go`:

```go
import "line-cli-go/cmd/webhook"

// inside init():
rootCmd.AddCommand(webhook.WebhookCmd)
```

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build -o line-cli-go .
./line-cli-go webhook --help
```

Expected: Shows subcommands `get`, `set`, `test`.

- [ ] **Step 6: Commit**

```bash
git add line-cli-go/cmd/webhook/ line-cli-go/cmd/root.go
git commit -m "feat(line-cli-go): add webhook commands (get, set, test)"
```

---

### Task 8: Content Command

**Files:**
- Create: `line-cli-go/cmd/content/content.go`
- Create: `line-cli-go/cmd/content/get.go`
- Modify: `line-cli-go/cmd/root.go`

- [ ] **Step 1: Create content parent command**

```go
// cmd/content/content.go
package content

import "github.com/spf13/cobra"

var ContentCmd = &cobra.Command{
	Use:   "content",
	Short: "Retrieve message content (images, videos, files)",
}

func init() {
	ContentCmd.AddCommand(getCmd)
}
```

- [ ] **Step 2: Implement content get**

```go
// cmd/content/get.go
package content

import (
	"fmt"
	"io"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Download message content by message ID",
	RunE: func(cmd *cobra.Command, args []string) error {
		messageID, _ := cmd.Flags().GetString("message-id")
		outputPath, _ := cmd.Flags().GetString("output")

		if messageID == "" {
			return fmt.Errorf("--message-id is required")
		}

		p := output.NewPrinter(config.JSONMode(), nil)

		blobAPI, err := client.NewMessagingBlobAPI()
		if err != nil {
			return err
		}

		body, err := blobAPI.GetMessageContent(messageID)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}
		defer body.Close()

		if outputPath != "" {
			f, err := os.Create(outputPath)
			if err != nil {
				return fmt.Errorf("creating output file: %w", err)
			}
			defer f.Close()
			n, err := io.Copy(f, body)
			if err != nil {
				return fmt.Errorf("writing content: %w", err)
			}
			p.Success("Content saved", map[string]string{
				"file":  outputPath,
				"bytes": fmt.Sprintf("%d", n),
			})
		} else {
			io.Copy(os.Stdout, body)
		}
		return nil
	},
}

func init() {
	getCmd.Flags().String("message-id", "", "message ID (required)")
	getCmd.Flags().String("output", "", "save to file path (default: stdout)")
}
```

Note: The SDK's `GetMessageContent` return type must be verified. It likely returns `(*http.Response, error)` or `(io.ReadCloser, error)`. Adjust accordingly at implementation time.

- [ ] **Step 3: Register in root.go, build and verify**

Add to `cmd/root.go`:

```go
import "line-cli-go/cmd/content"

// inside init():
rootCmd.AddCommand(content.ContentCmd)
```

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build -o line-cli-go .
./line-cli-go content --help
```

Expected: Shows subcommand `get`.

- [ ] **Step 4: Commit**

```bash
git add line-cli-go/cmd/content/ line-cli-go/cmd/root.go
git commit -m "feat(line-cli-go): add content get command for binary downloads"
```

---

### Task 9: Quota Commands

**Files:**
- Create: `line-cli-go/cmd/quota/quota.go`
- Create: `line-cli-go/cmd/quota/get.go`
- Create: `line-cli-go/cmd/quota/consumption.go`
- Modify: `line-cli-go/cmd/root.go`

- [ ] **Step 1: Create quota parent command**

```go
// cmd/quota/quota.go
package quota

import "github.com/spf13/cobra"

var QuotaCmd = &cobra.Command{
	Use:   "quota",
	Short: "Check message quota and consumption",
}

func init() {
	QuotaCmd.AddCommand(getCmd)
	QuotaCmd.AddCommand(consumptionCmd)
}
```

- [ ] **Step 2: Implement quota get**

```go
// cmd/quota/get.go
package quota

import (
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get the message quota for this channel",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.GetMessageQuota()
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"type":  resp.Type,
			"value": resp.Value,
		})
		return nil
	},
}
```

- [ ] **Step 3: Implement quota consumption**

```go
// cmd/quota/consumption.go
package quota

import (
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var consumptionCmd = &cobra.Command{
	Use:   "consumption",
	Short: "Get current message quota consumption",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.GetMessageQuotaConsumption()
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"totalUsage": resp.TotalUsage,
		})
		return nil
	},
}
```

- [ ] **Step 4: Register in root.go, build and verify**

Add to `cmd/root.go`:

```go
import "line-cli-go/cmd/quota"

// inside init():
rootCmd.AddCommand(quota.QuotaCmd)
```

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go build -o line-cli-go .
./line-cli-go quota --help
```

Expected: Shows subcommands `get`, `consumption`.

- [ ] **Step 5: Commit**

```bash
git add line-cli-go/cmd/quota/ line-cli-go/cmd/root.go
git commit -m "feat(line-cli-go): add quota commands (get, consumption)"
```

---

### Task 10: Integration Tests

**Files:**
- Create: `line-cli-go/test/integration/cli_test.go`

Prerequisites: line-api-mock running via `docker compose up` in `../line-api-mock/`.

- [ ] **Step 1: Write integration test**

```go
// test/integration/cli_test.go
package integration

import (
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
)

var (
	binary  string
	baseURL string
)

func TestMain(m *testing.M) {
	// Build CLI binary
	build := exec.Command("go", "build", "-o", "../../line-cli-go-test", "../..")
	build.Dir = "."
	if out, err := build.CombinedOutput(); err != nil {
		panic("build failed: " + string(out))
	}
	binary = "../../line-cli-go-test"
	baseURL = os.Getenv("LINE_BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}
	code := m.Run()
	os.Remove(binary)
	os.Exit(code)
}

func runCLI(t *testing.T, args ...string) (string, error) {
	t.Helper()
	allArgs := append([]string{"--base-url", baseURL, "--json"}, args...)
	cmd := exec.Command(binary, allArgs...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func TestTokenIssueAndVerify(t *testing.T) {
	channelID := os.Getenv("TEST_CHANNEL_ID")
	channelSecret := os.Getenv("TEST_CHANNEL_SECRET")
	if channelID == "" || channelSecret == "" {
		t.Skip("TEST_CHANNEL_ID and TEST_CHANNEL_SECRET required")
	}

	// Issue token
	out, err := runCLI(t, "--channel-id", channelID, "--channel-secret", channelSecret,
		"token", "issue")
	if err != nil {
		t.Fatalf("token issue failed: %s\n%s", err, out)
	}

	var issueResp map[string]any
	if err := json.Unmarshal([]byte(out), &issueResp); err != nil {
		t.Fatalf("failed to parse issue response: %v\noutput: %s", err, out)
	}
	token, ok := issueResp["access_token"].(string)
	if !ok || token == "" {
		t.Fatalf("no access_token in response: %v", issueResp)
	}

	// Verify token
	out, err = runCLI(t, "--access-token", token, "token", "verify")
	if err != nil {
		t.Fatalf("token verify failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "client_id") {
		t.Errorf("verify response missing client_id: %s", out)
	}

	// Revoke token
	out, err = runCLI(t, "--access-token", token, "token", "revoke")
	if err != nil {
		t.Fatalf("token revoke failed: %s\n%s", err, out)
	}
}

func TestPushAndProfile(t *testing.T) {
	token := os.Getenv("TEST_ACCESS_TOKEN")
	userID := os.Getenv("TEST_USER_ID")
	if token == "" || userID == "" {
		t.Skip("TEST_ACCESS_TOKEN and TEST_USER_ID required")
	}

	// Push message
	out, err := runCLI(t, "--access-token", token,
		"message", "push", "--to", userID, "--text", "hello from Go CLI test")
	if err != nil {
		t.Fatalf("push failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "sentMessages") {
		t.Errorf("push response missing sentMessages: %s", out)
	}

	// Get profile
	out, err = runCLI(t, "--access-token", token,
		"profile", "get", "--user-id", userID)
	if err != nil {
		t.Fatalf("profile get failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "displayName") {
		t.Errorf("profile response missing displayName: %s", out)
	}
}

func TestQuota(t *testing.T) {
	token := os.Getenv("TEST_ACCESS_TOKEN")
	if token == "" {
		t.Skip("TEST_ACCESS_TOKEN required")
	}

	out, err := runCLI(t, "--access-token", token, "quota", "get")
	if err != nil {
		t.Fatalf("quota get failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "type") {
		t.Errorf("quota response missing type: %s", out)
	}

	out, err = runCLI(t, "--access-token", token, "quota", "consumption")
	if err != nil {
		t.Fatalf("quota consumption failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "totalUsage") {
		t.Errorf("consumption response missing totalUsage: %s", out)
	}
}

func TestWebhookGetAndSet(t *testing.T) {
	token := os.Getenv("TEST_ACCESS_TOKEN")
	if token == "" {
		t.Skip("TEST_ACCESS_TOKEN required")
	}

	// Get current webhook
	out, err := runCLI(t, "--access-token", token, "webhook", "get")
	if err != nil {
		t.Fatalf("webhook get failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "endpoint") {
		t.Errorf("webhook response missing endpoint: %s", out)
	}

	// Set webhook
	out, err = runCLI(t, "--access-token", token,
		"webhook", "set", "--url", "https://example.com/webhook")
	if err != nil {
		t.Fatalf("webhook set failed: %s\n%s", err, out)
	}
}
```

- [ ] **Step 2: Run integration tests (requires line-api-mock running)**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go

# Start mock if not running:
# cd ../line-api-mock && docker compose up -d && cd ../line-cli-go

# Set test env vars (get these from mock's admin UI or startup output):
export TEST_CHANNEL_ID="<seeded-channel-id>"
export TEST_CHANNEL_SECRET="<seeded-channel-secret>"
export TEST_ACCESS_TOKEN="<issued-token>"
export TEST_USER_ID="<seeded-user-id>"

go test ./test/integration/ -v -count=1
```

Expected: Tests pass against running mock server.

- [ ] **Step 3: Commit**

```bash
git add line-cli-go/test/
git commit -m "test(line-cli-go): add integration tests for CLI against line-api-mock"
```

---

### Task 11: Documentation

**Files:**
- Create: `line-cli-go/README.md`
- Create: `line-cli-go/.env.example`
- Create: `line-cli-go/.line-cli.yaml.example`

- [ ] **Step 1: Create .env.example**

```
LINE_BASE_URL=http://localhost:3000
LINE_CHANNEL_ID=1234567890
LINE_CHANNEL_SECRET=abcdef1234567890abcdef1234567890
LINE_ACCESS_TOKEN=
```

- [ ] **Step 2: Create .line-cli.yaml.example**

```yaml
base_url: http://localhost:3000
channel_id: "1234567890"
channel_secret: "abcdef1234567890abcdef1234567890"
# access_token: "" # set after `token issue`
```

- [ ] **Step 3: Create README.md**

```markdown
# line-cli-go

LINE Messaging API CLI client (Go) — [line-api-mock](../line-api-mock) 연동 샘플

LINE 公式 Go SDK ([line-bot-sdk-go](https://github.com/line/line-bot-sdk-go) v8) を使用して、
line-api-mock が実装する全エンドポイントを操作する CLI ツール。

## クイックスタート

### 1. line-api-mock を起動

```bash
cd ../line-api-mock
docker compose up -d
```

起動ログに表示されるチャンネル ID・シークレットを控えてください。

### 2. ビルド

```bash
cd ../line-cli-go
go build -o line-cli-go .
```

### 3. 設定

```bash
cp .env.example .env
# .env を編集してチャンネル ID・シークレットを設定
```

または設定ファイルを使用:

```bash
cp .line-cli.yaml.example .line-cli.yaml
# .line-cli.yaml を編集
```

### 4. トークン発行

```bash
./line-cli-go token issue
```

### 5. メッセージ送信

```bash
./line-cli-go message push --to <USER_ID> --text "Hello from Go CLI!"
```

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `token issue` | v2 チャンネルアクセストークン発行 |
| `token issue-v3` | v2.1 JWT ベーストークン発行 |
| `token verify` | トークン検証 |
| `token revoke` | トークン失効 |
| `token list-kids` | v2.1 有効キー ID 一覧 |
| `message push` | プッシュメッセージ送信 |
| `message reply` | リプライメッセージ送信 |
| `message multicast` | マルチキャスト送信 |
| `message broadcast` | ブロードキャスト送信 |
| `message narrowcast` | ナローキャスト送信 (非同期) |
| `profile get` | ユーザープロフィール取得 |
| `webhook get` | Webhook エンドポイント取得 |
| `webhook set` | Webhook エンドポイント設定 |
| `webhook test` | Webhook 接続テスト |
| `content get` | メッセージコンテンツ取得 |
| `quota get` | メッセージクォータ取得 |
| `quota consumption` | クォータ消費量取得 |

## 設定

設定の優先順位: 環境変数 → 設定ファイル → CLI フラグ

| 環境変数 | CLI フラグ | 説明 | デフォルト |
|---------|-----------|------|-----------|
| `LINE_BASE_URL` | `--base-url` | mock サーバー URL | `http://localhost:3000` |
| `LINE_CHANNEL_ID` | `--channel-id` | チャンネル ID | (必須) |
| `LINE_CHANNEL_SECRET` | `--channel-secret` | チャンネルシークレット | (必須) |
| `LINE_ACCESS_TOKEN` | `--access-token` | アクセストークン | (任意) |

### JSON 出力

全コマンドで `--json` フラグを付けると JSON 形式で出力:

```bash
./line-cli-go --json token issue
./line-cli-go --json message push --to U123 --text "hello"
```

### ConoHa 上の mock サーバーに接続

```yaml
# .line-cli.yaml
base_url: http://<conoha-server-ip>:3000
channel_id: "1234567890"
channel_secret: "abcdef..."
```

## 技術スタック

- Go 1.24+
- [line-bot-sdk-go](https://github.com/line/line-bot-sdk-go) v8
- [cobra](https://github.com/spf13/cobra) — CLI フレームワーク
- [viper](https://github.com/spf13/viper) — 設定管理
```

- [ ] **Step 4: Register in root README (if applicable)**

Check if the root `README.md` lists sample apps. If so, add `line-cli-go` entry.

- [ ] **Step 5: Commit**

```bash
git add line-cli-go/README.md line-cli-go/.env.example line-cli-go/.line-cli.yaml.example
git commit -m "docs(line-cli-go): add README, .env.example, and config example"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run all unit tests**

```bash
cd /root/dev/crowdy/conoha-cli-app-samples/line-cli-go
go test ./... -v
```

Expected: All unit tests pass (config + output).

- [ ] **Step 2: Full build**

```bash
go build -o line-cli-go .
./line-cli-go --help
./line-cli-go token --help
./line-cli-go message --help
./line-cli-go profile --help
./line-cli-go webhook --help
./line-cli-go content --help
./line-cli-go quota --help
```

Expected: All help outputs show correct subcommands and flags.

- [ ] **Step 3: Manual smoke test against mock (if running)**

```bash
# Token lifecycle
./line-cli-go token issue --channel-id <ID> --channel-secret <SECRET>
./line-cli-go token verify --access-token <TOKEN>

# Message
./line-cli-go message push --access-token <TOKEN> --to <USER_ID> --text "smoke test"

# Profile
./line-cli-go profile get --access-token <TOKEN> --user-id <USER_ID>

# Quota
./line-cli-go quota get --access-token <TOKEN>
./line-cli-go quota consumption --access-token <TOKEN>
```

- [ ] **Step 4: Run integration tests (if mock is running)**

```bash
go test ./test/integration/ -v -count=1
```

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A line-cli-go/
git commit -m "fix(line-cli-go): address issues found in final verification"
```
