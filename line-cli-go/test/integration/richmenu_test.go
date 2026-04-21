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
	if !strings.Contains(out, "Rich menu payload valid") {
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
	info, statErr := os.Stat(outFile)
	if statErr != nil {
		t.Errorf("get-image: stat output file: %v", statErr)
	} else if info.Size() == 0 {
		t.Errorf("get-image produced empty file")
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
