import type { MiddlewareHandler } from "hono";
import { config } from "../config.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Browsers automatically resend Basic Auth on cross-origin form submissions,
// so a malicious site could mount a CSRF attack against the admin UI by
// auto-submitting a hidden <form action="https://mock.example.com/admin/...">
// while the operator's browser still holds the realm credentials. Verifying
// that the request's Origin (or Referer fallback) matches APP_BASE_URL stops
// that vector without changing the auth model.
//
// Limitations:
// - This is the OWASP "Verifying Origin With Standard Headers" recipe; it
//   blocks classic form-submit CSRF but is not a substitute for a per-session
//   token if the threat model includes XSS in trusted code.
// - A request with neither Origin nor Referer is rejected. Modern browsers
//   send Origin on POST/PUT/DELETE reliably; tools that don't (curl scripts)
//   must opt in by setting Origin to APP_BASE_URL or skip the admin CSRF
//   path by issuing safe-method requests only.
export function adminCsrf(): MiddlewareHandler {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(config.appBaseUrl).origin;
  } catch {
    throw new Error(
      `[admin/csrf] APP_BASE_URL is not a valid URL: ${config.appBaseUrl}`
    );
  }

  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    const origin = c.req.header("origin");
    if (origin) {
      if (origin === expectedOrigin) return next();
      return c.text(
        `Forbidden: Origin ${origin} does not match APP_BASE_URL`,
        403
      );
    }

    const referer = c.req.header("referer");
    if (referer) {
      try {
        if (new URL(referer).origin === expectedOrigin) return next();
      } catch {
        /* fall through to rejection */
      }
      return c.text(
        `Forbidden: Referer does not match APP_BASE_URL`,
        403
      );
    }

    return c.text(
      "Forbidden: state-changing admin requests require Origin or Referer",
      403
    );
  };
}
