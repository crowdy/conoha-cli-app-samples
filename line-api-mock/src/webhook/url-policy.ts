import { config } from "../config.js";

export interface UrlPolicyResult {
  ok: boolean;
  reason?: string;
}

const PRIVATE_CIDR_PATTERNS: RegExp[] = [
  // IPv4 RFC1918 and friends
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // carrier-grade NAT
  // IPv6 loopback/link-local/ULA
  /^::1$/,
  /^::$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd/i,
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

export function checkWebhookUrl(raw: string): UrlPolicyResult {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `scheme ${u.protocol} not allowed` };
  }
  if (config.allowPrivateWebhooks) return { ok: true };

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: `hostname ${host} blocked (set MOCK_ALLOW_PRIVATE_WEBHOOKS=1 to allow)` };
  }
  for (const p of PRIVATE_CIDR_PATTERNS) {
    if (p.test(host)) {
      return { ok: false, reason: `private/loopback address ${host} blocked (set MOCK_ALLOW_PRIVATE_WEBHOOKS=1 to allow)` };
    }
  }
  return { ok: true };
}
