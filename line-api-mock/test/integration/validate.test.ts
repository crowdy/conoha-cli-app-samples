import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;

const ENDPOINTS = [
  "/v2/bot/message/validate/reply",
  "/v2/bot/message/validate/push",
  "/v2/bot/message/validate/multicast",
  "/v2/bot/message/validate/narrowcast",
  "/v2/bot/message/validate/broadcast",
] as const;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { validateRouter } = await import("../../src/mock/validate.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9300000001",
      channelSecret: randomHex(16),
      name: "Validate Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  app = new Hono();
  app.route("/", validateRouter);
}, 60_000);

afterAll(async () => container.stop());

describe.each(ENDPOINTS)("POST %s", (path) => {
  it("accepts valid text messages with 200", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: "text", text: "hi" }] }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects unknown message type with 400", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: "bogus" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing bearer with 401", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ type: "text", text: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });
});
