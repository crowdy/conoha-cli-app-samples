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
