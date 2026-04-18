import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { checkWebhookUrl } from "../../src/webhook/url-policy.js";

describe("checkWebhookUrl (default policy: private blocked)", () => {
  // Ensure MOCK_ALLOW_PRIVATE_WEBHOOKS is not set during these tests.
  const origEnv = process.env.MOCK_ALLOW_PRIVATE_WEBHOOKS;
  beforeEach(() => {
    delete process.env.MOCK_ALLOW_PRIVATE_WEBHOOKS;
  });
  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.MOCK_ALLOW_PRIVATE_WEBHOOKS = origEnv;
    } else {
      delete process.env.MOCK_ALLOW_PRIVATE_WEBHOOKS;
    }
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3000",
    "http://localhost:80",
    "http://10.0.0.1",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://metadata.google.internal",
    "ftp://example.com",
    "file:///etc/passwd",
    "not a url",
  ])("rejects %s", (url) => {
    expect(checkWebhookUrl(url).ok).toBe(false);
  });

  it.each([
    "https://example.com/webhook",
    "http://api.example.com:8080/line",
  ])("accepts %s", (url) => {
    expect(checkWebhookUrl(url).ok).toBe(true);
  });
});
