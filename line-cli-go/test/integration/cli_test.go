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

	out, err = runCLI(t, "--access-token", token, "token", "verify")
	if err != nil {
		t.Fatalf("token verify failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "client_id") {
		t.Errorf("verify response missing client_id: %s", out)
	}

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

	out, err := runCLI(t, "--access-token", token,
		"message", "push", "--to", userID, "--text", "hello from Go CLI test")
	if err != nil {
		t.Fatalf("push failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "sentMessages") {
		t.Errorf("push response missing sentMessages: %s", out)
	}

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

	out, err := runCLI(t, "--access-token", token, "webhook", "get")
	if err != nil {
		t.Fatalf("webhook get failed: %s\n%s", err, out)
	}
	if !strings.Contains(out, "endpoint") {
		t.Errorf("webhook response missing endpoint: %s", out)
	}

	out, err = runCLI(t, "--access-token", token,
		"webhook", "set", "--url", "https://example.com/webhook")
	if err != nil {
		t.Fatalf("webhook set failed: %s\n%s", err, out)
	}
}
