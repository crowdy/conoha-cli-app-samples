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

// TestRichMenuBulkViaPayload exercises the --payload-file path of bulk-link / bulk-unlink,
// and verifies that flag values override payload fields (the dual-input override semantics
// that the lifecycle test does not cover).
func TestRichMenuBulkViaPayload(t *testing.T) {
	token := os.Getenv("TEST_ACCESS_TOKEN")
	userID := os.Getenv("TEST_USER_ID")
	if token == "" || userID == "" {
		t.Skip("TEST_ACCESS_TOKEN and TEST_USER_ID required")
	}

	// Create two rich menus so flag-override can be distinguished by which one the user ends up linked to.
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
		if r.RichMenuId == "" {
			t.Fatalf("empty richMenuId from create (%s): %s", label, out)
		}
		return r.RichMenuId
	}

	rmPayload := createRM("payload")
	rmFlag := createRM("flag")
	t.Cleanup(func() {
		runCLI(t, "--access-token", token, "richmenu", "delete", "--rich-menu-id", rmPayload)
		runCLI(t, "--access-token", token, "richmenu", "delete", "--rich-menu-id", rmFlag)
	})

	// Substitute bulk.json template placeholders with real IDs and write to a temp file.
	writeBulkJSON := func(rmID, uid string) string {
		raw, err := os.ReadFile(filepath.Join("testdata", "bulk.json"))
		if err != nil {
			t.Fatalf("read bulk.json: %v", err)
		}
		body := strings.ReplaceAll(string(raw), "__RM__", rmID)
		body = strings.ReplaceAll(body, "__U1__", uid)
		body = strings.ReplaceAll(body, "__U2__", uid) // single available user; array of duplicates is fine for this mock
		p := filepath.Join(t.TempDir(), "bulk.json")
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatalf("write substituted bulk.json: %v", err)
		}
		return p
	}

	t.Run("bulk-link payload-file only", func(t *testing.T) {
		payloadFile := writeBulkJSON(rmPayload, userID)
		out, errOut, err := runCLI(t, "--access-token", token,
			"richmenu", "bulk-link", "--payload-file", payloadFile)
		if err != nil {
			t.Fatalf("bulk-link via payload failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
		}
		// Verify the link landed on rmPayload (not on rmFlag).
		out, errOut, err = runCLI(t, "--access-token", token,
			"richmenu", "get-for-user", "--user-id", userID)
		if err != nil {
			t.Fatalf("get-for-user failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
		}
		if !strings.Contains(out, rmPayload) {
			t.Errorf("expected user linked to %s (from payload), got: %s", rmPayload, out)
		}
		// Clean up this link via payload-based unlink (exercises bulk-unlink --payload-file).
		raw := []byte(`{"userIds":["` + userID + `"]}`)
		pf := filepath.Join(t.TempDir(), "unlink.json")
		if err := os.WriteFile(pf, raw, 0o644); err != nil {
			t.Fatalf("write unlink.json: %v", err)
		}
		out, errOut, err = runCLI(t, "--access-token", token,
			"richmenu", "bulk-unlink", "--payload-file", pf)
		if err != nil {
			t.Fatalf("bulk-unlink via payload failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
		}
	})

	t.Run("bulk-link flag overrides payload richMenuId", func(t *testing.T) {
		// Payload says rmPayload; flag says rmFlag. Flag must win.
		payloadFile := writeBulkJSON(rmPayload, userID)
		out, errOut, err := runCLI(t, "--access-token", token,
			"richmenu", "bulk-link",
			"--payload-file", payloadFile,
			"--rich-menu-id", rmFlag)
		if err != nil {
			t.Fatalf("bulk-link with override failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
		}
		out, errOut, err = runCLI(t, "--access-token", token,
			"richmenu", "get-for-user", "--user-id", userID)
		if err != nil {
			t.Fatalf("get-for-user failed: %s\nstdout: %s\nstderr: %s", err, out, errOut)
		}
		if !strings.Contains(out, rmFlag) {
			t.Errorf("expected user linked to %s (flag override), got: %s", rmFlag, out)
		}
		if strings.Contains(out, rmPayload) && !strings.Contains(out, rmFlag) {
			t.Errorf("override failed: user linked to payload %s instead of flag %s", rmPayload, rmFlag)
		}
		// Best-effort unlink so the next test / run isn't dirty.
		runCLI(t, "--access-token", token, "richmenu", "unlink", "--user-id", userID)
	})
}
