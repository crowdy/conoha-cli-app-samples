import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDb, type DbHandle } from "../helpers/testcontainer.js";

let container: DbHandle;
let app: any;
let token: string;
let messageId: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { contentRouter } = await import("../../src/mock/content.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, messages, messageContents } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr, messageId: genMid } = await import(
    "../../src/lib/id.js"
  );

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9000000006",
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
  const [u] = await db
    .insert(virtualUsers)
    .values({ userId: "U" + randomHex(16), displayName: "u" })
    .returning();
  messageId = genMid();
  const [m] = await db
    .insert(messages)
    .values({
      messageId,
      channelId: ch.id,
      virtualUserId: u.id,
      direction: "user_to_bot",
      type: "image",
      payload: { type: "image" },
    })
    .returning();
  await db.insert(messageContents).values({
    messageId: m.id,
    contentType: "image/png",
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });

  app = new Hono();
  app.route("/", contentRouter);
}, 60_000);

afterAll(async () => container.stop());

describe("content endpoints", () => {
  it("returns bytes for an existing message content", async () => {
    const res = await app.request(`/v2/bot/message/${messageId}/content`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0x89);
  });

  it("returns 404 for unknown message id", async () => {
    const res = await app.request("/v2/bot/message/000/content", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("transcoding endpoint always succeeded", async () => {
    const res = await app.request(
      `/v2/bot/message/${messageId}/content/transcoding`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    expect(await res.json()).toEqual({ status: "succeeded" });
  });
});
