import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;
let botUserId: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { messageRouter } = await import("../../src/mock/message.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9000000001",
      channelSecret: randomHex(16),
      name: "Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });
  botUserId = "U" + randomHex(16);
  const [u] = await db
    .insert(virtualUsers)
    .values({ userId: botUserId, displayName: "User" })
    .returning();
  await db.insert(channelFriends).values({ channelId: ch.id, userId: u.id });

  app = new Hono();
  app.route("/", messageRouter);
}, 60_000);

afterAll(async () => container.stop());

describe("POST /v2/bot/message/push", () => {
  it("accepts a valid push and returns sentMessages", async () => {
    const res = await app.request("/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: botUserId,
        messages: [{ type: "text", text: "hello" }],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.sentMessages)).toBe(true);
    expect(json.sentMessages).toHaveLength(1);
    expect(typeof json.sentMessages[0].id).toBe("string");
  });

  it("rejects missing bearer", async () => {
    const res = await app.request("/v2/bot/message/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: botUserId, messages: [{ type: "text", text: "x" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects unknown user", async () => {
    const res = await app.request("/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: "Uffffffffffffffffffffffffffffffff",
        messages: [{ type: "text", text: "hi" }],
      }),
    });
    expect(res.status).toBe(400);
  });
});
