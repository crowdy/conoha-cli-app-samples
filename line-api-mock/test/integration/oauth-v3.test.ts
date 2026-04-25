import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Hono } from "hono";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: Hono;
let seededChannelId: string;
let botUserId: string;

function makeAssertion(iss: string): string {
  // We don't verify signatures in the mock — only the `iss` claim is read.
  // Forge a JWT with `header.payload.signature` shape; the signature is
  // ignored. base64url encode payload only.
  const payload = Buffer.from(JSON.stringify({ iss })).toString("base64url");
  return `header.${payload}.signature`;
}

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { oauthV3Router } = await import("../../src/mock/oauth-v3.js");
  const { messageRouter } = await import("../../src/mock/message.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, virtualUsers, channelFriends } = await import(
    "../../src/db/schema.js"
  );
  const { randomHex } = await import("../../src/lib/id.js");

  seededChannelId = "9100000017";
  const [ch] = await db
    .insert(channels)
    .values({
      channelId: seededChannelId,
      channelSecret: randomHex(16),
      name: "OAuth v3 Test",
    })
    .returning();

  // Seed a bot-friend user so push has a valid recipient.
  botUserId = "U" + randomHex(16);
  const [u] = await db
    .insert(virtualUsers)
    .values({ userId: botUserId, displayName: "v3 Test User" })
    .returning();
  await db.insert(channelFriends).values({ channelId: ch.id, userId: u.id });

  app = new Hono();
  app.route("/", oauthV3Router);
  app.route("/", messageRouter);
}, 60_000);

afterAll(async () => container.stop());

describe("POST /oauth2/v2.1/token", () => {
  it("issues an access token using explicit client_id form field", async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: "header.payload.signature",
      client_id: seededChannelId,
    });
    const res = await app.request("/oauth2/v2.1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token_type).toBe("Bearer");
    expect(typeof json.access_token).toBe("string");
    expect(typeof json.expires_in).toBe("number");
    expect(typeof json.key_id).toBe("string");
  });

  it("falls back to JWT iss claim when client_id form field is missing", async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: makeAssertion(seededChannelId),
    });
    const res = await app.request("/oauth2/v2.1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.access_token).toBe("string");
  });

  it("rejects unknown client_id", async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion: "h.p.s",
      client_id: "9999999999",
    });
    const res = await app.request("/oauth2/v2.1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_client");
  });

  it("rejects missing client_assertion", async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: seededChannelId,
    });
    const res = await app.request("/oauth2/v2.1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(400);
  });
});

describe("v3 token end-to-end", () => {
  it("token issued by /oauth2/v2.1/token authenticates a push call", async () => {
    const tokenRes = await app.request("/oauth2/v2.1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_assertion: "h.p.s",
        client_id: seededChannelId,
      }),
    });
    const { access_token, key_id } = await tokenRes.json();

    const push = await app.request("/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        to: botUserId,
        messages: [{ type: "text", text: "hi via v3 token" }],
      }),
    });
    expect(push.status).toBe(200);

    const kidsRes = await app.request(
      `/oauth2/v2.1/tokens/kid?client_id=${seededChannelId}`
    );
    expect(kidsRes.status).toBe(200);
    const kidsJson = await kidsRes.json();
    expect(kidsJson.kids).toContain(key_id);
  });

  it("revoked token cannot push", async () => {
    const tokenRes = await app.request("/oauth2/v2.1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_assertion: "h.p.s",
        client_id: seededChannelId,
      }),
    });
    const { access_token } = await tokenRes.json();

    const rev = await app.request("/oauth2/v2.1/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token }),
    });
    expect(rev.status).toBe(200);

    const push = await app.request("/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        to: botUserId,
        messages: [{ type: "text", text: "should fail" }],
      }),
    });
    expect(push.status).toBe(401);
  });
});
