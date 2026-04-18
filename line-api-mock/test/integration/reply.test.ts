import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;
let channelDbId: number;
let virtualUserId: number;
let existingReplyToken = "rt-abc-123";

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { messageRouter } = await import("../../src/mock/message.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, messages } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr, messageId } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9000000002",
      channelSecret: randomHex(16),
      name: "Test",
    })
    .returning();
  channelDbId = ch.id;
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });
  const [u] = await db
    .insert(virtualUsers)
    .values({ userId: "U" + randomHex(16), displayName: "u" })
    .returning();
  virtualUserId = u.id;
  await db.insert(messages).values({
    messageId: messageId(),
    channelId: ch.id,
    virtualUserId: u.id,
    direction: "user_to_bot",
    type: "text",
    payload: { type: "text", text: "hi" },
    replyToken: existingReplyToken,
  });

  app = new Hono();
  app.route("/", messageRouter);
}, 60_000);

afterAll(async () => container.stop());

describe("POST /v2/bot/message/reply", () => {
  it("replies using a valid reply token", async () => {
    const res = await app.request("/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        replyToken: existingReplyToken,
        messages: [{ type: "text", text: "echoed" }],
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).sentMessages).toHaveLength(1);
  });

  it("rejects unknown reply token", async () => {
    const res = await app.request("/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        replyToken: "does-not-exist",
        messages: [{ type: "text", text: "x" }],
      }),
    });
    expect(res.status).toBe(400);
  });
});
