import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { adminCsrf } from "../../src/admin/csrf.js";

// `config.appBaseUrl` defaults to `http://localhost:3000`. These tests pin
// the documented matching/rejection rules of the CSRF middleware against
// that default — they will need updating only if the default in config.ts
// changes.
const SAME_ORIGIN = "http://localhost:3000";
const OTHER_ORIGIN = "https://attacker.example.com";

function appWithCsrf() {
  const app = new Hono();
  app.use("*", adminCsrf());
  app.get("/admin", (c) => c.text("ok"));
  app.post("/admin/x", (c) => c.text("ok"));
  app.delete("/admin/x", (c) => c.text("ok"));
  return app;
}

describe("adminCsrf middleware", () => {
  it("lets safe-method requests through without an Origin header", async () => {
    const res = await appWithCsrf().request("/admin", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("accepts POST when Origin matches APP_BASE_URL", async () => {
    const res = await appWithCsrf().request("/admin/x", {
      method: "POST",
      headers: { origin: SAME_ORIGIN },
    });
    expect(res.status).toBe(200);
  });

  it("rejects POST when Origin is a different host (CSRF attempt)", async () => {
    const res = await appWithCsrf().request("/admin/x", {
      method: "POST",
      headers: { origin: OTHER_ORIGIN },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Origin .* does not match/);
  });

  it("falls back to Referer when Origin is absent", async () => {
    const res = await appWithCsrf().request("/admin/x", {
      method: "DELETE",
      headers: { referer: `${SAME_ORIGIN}/admin/channels` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects when Referer is on a different origin", async () => {
    const res = await appWithCsrf().request("/admin/x", {
      method: "DELETE",
      headers: { referer: `${OTHER_ORIGIN}/some/page` },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Referer does not match/);
  });

  it("rejects state-changing requests with neither Origin nor Referer", async () => {
    const res = await appWithCsrf().request("/admin/x", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/require Origin or Referer/);
  });

  it("rejects when Referer is a malformed URL", async () => {
    const res = await appWithCsrf().request("/admin/x", {
      method: "POST",
      headers: { referer: "not-a-url" },
    });
    expect(res.status).toBe(403);
  });
});
