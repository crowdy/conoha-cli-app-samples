import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDb, type DbHandle } from "../helpers/testcontainer.js";

let container: DbHandle;
let app: any;
let token: string;
let u1: string;
let u2: string;

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
      channelId: "9000000003",
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
  u1 = "U" + randomHex(16);
  u2 = "U" + randomHex(16);
  const [a] = await db
    .insert(virtualUsers)
    .values({ userId: u1, displayName: "a" })
    .returning();
  const [b] = await db
    .insert(virtualUsers)
    .values({ userId: u2, displayName: "b" })
    .returning();
  await db.insert(channelFriends).values([
    { channelId: ch.id, userId: a.id },
    { channelId: ch.id, userId: b.id },
  ]);
  app = new Hono();
  app.route("/", messageRouter);
}, 60_000);

afterAll(async () => container.stop());

describe("bulk send", () => {
  it("multicast to multiple users", async () => {
    const res = await app.request("/v2/bot/message/multicast", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: [u1, u2],
        messages: [{ type: "text", text: "hi all" }],
      }),
    });
    expect(res.status).toBe(200);
  });

  it("broadcast to all friends", async () => {
    const res = await app.request("/v2/bot/message/broadcast", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: "text", text: "news" }] }),
    });
    expect(res.status).toBe(200);
  });

  it("narrowcast returns 202 + request-id; progress reports succeeded", async () => {
    const res = await app.request("/v2/bot/message/narrowcast", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: "text", text: "x" }] }),
    });
    expect(res.status).toBe(202);
    expect(res.headers.get("x-line-request-id")).toBeTruthy();
    const prog = await app.request(
      "/v2/bot/message/progress/narrowcast?requestId=abc",
      { headers: { authorization: `Bearer ${token}` } }
    );
    expect(prog.status).toBe(200);
    expect((await prog.json()).phase).toBe("succeeded");
  });

  it("narrowcast progress without requestId returns 400", async () => {
    const res = await app.request("/v2/bot/message/progress/narrowcast", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });
});
