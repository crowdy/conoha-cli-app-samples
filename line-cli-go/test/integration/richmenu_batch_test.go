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
