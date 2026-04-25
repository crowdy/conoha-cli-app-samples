import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDb, type DbHandle } from "../helpers/testcontainer.js";

let container: DbHandle;
let app: any;
let seededChannelId: string;
let seededChannelSecret: string;

beforeAll(async () => {
  container = await startDb();
  // Import AFTER DATABASE_URL is set so Drizzle binds to the container.
  const { Hono } = await import("hono");
  const { oauthRouter } = await import("../../src/mock/oauth.js");
  const { db } = await import("../../src/db/client.js");
  const { channels } = await import("../../src/db/schema.js");
  const { randomHex } = await import("../../src/lib/id.js");

  seededChannelId = "1234567890";
  seededChannelSecret = randomHex(16);
  await db.insert(channels).values({
    channelId: seededChannelId,
    channelSecret: seededChannelSecret,
    name: "Test",
  });

  app = new Hono();
  app.route("/", oauthRouter);
}, 60_000);

afterAll(async () => {
  await container.stop();
});

describe("POST /v2/oauth/accessToken", () => {
  it("issues a token for valid credentials", async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: seededChannelId,
      client_secret: seededChannelSecret,
    });
    const res = await app.request("/v2/oauth/accessToken", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token_type).toBe("Bearer");
    expect(typeof json.access_token).toBe("string");
    expect(typeof json.expires_in).toBe("number");
  });

  it("rejects invalid secret", async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: seededChannelId,
      client_secret: "wrong",
    });
    const res = await app.request("/v2/oauth/accessToken", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(400);
  });
});

describe("verify + revoke", () => {
  it("verify then revoke then verify fails", async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: seededChannelId,
      client_secret: seededChannelSecret,
    });
    const { access_token } = await (
      await app.request("/v2/oauth/accessToken", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      })
    ).json();

    const v1 = await app.request("/v2/oauth/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token }),
    });
    expect(v1.status).toBe(200);

    const rev = await app.request("/v2/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token }),
    });
    expect(rev.status).toBe(200);

    const v2 = await app.request("/v2/oauth/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token }),
    });
    expect(v2.status).toBe(400);
  });
});
