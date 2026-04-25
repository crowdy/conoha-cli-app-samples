import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDb, type DbHandle } from "../helpers/testcontainer.js";

let container: DbHandle;
let app: any;
let token: string;
let channelId: string;
let friendUserIds: string[];

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { botInfoRouter } = await import("../../src/mock/bot-info.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  channelId = "9400000001";
  const [ch] = await db
    .insert(channels)
    .values({
      channelId,
      channelSecret: randomHex(16),
      name: "Bot Info Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  friendUserIds = [];
  for (let i = 0; i < 3; i++) {
    const userId = "U" + randomHex(16);
    friendUserIds.push(userId);
    const [u] = await db
      .insert(virtualUsers)
      .values({ userId, displayName: `Friend ${i}` })
      .returning();
    await db.insert(channelFriends).values({
      channelId: ch.id,
      userId: u.id,
      blocked: i === 0,
    });
  }

  app = new Hono();
  app.route("/", botInfoRouter);
});

afterAll(async () => container.stop());

describe("GET /v2/bot/info", () => {
  it("returns deterministic bot info derived from channel", async () => {
    const res = await app.request("/v2/bot/info", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toMatch(/^U[0-9a-f]{32}$/);
    expect(body.basicId).toBe("@" + channelId.slice(0, 8));
    expect(body.displayName).toBe("Bot Info Test");
    expect(body.chatMode).toBe("chat");
    expect(body.markAsReadMode).toBe("manual");
  });

  it("rejects missing bearer", async () => {
    const res = await app.request("/v2/bot/info");
    expect(res.status).toBe(401);
  });
});

describe("GET /v2/bot/followers/ids", () => {
  it("returns non-blocked friends' userIds", async () => {
    const res = await app.request("/v2/bot/followers/ids", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.userIds)).toBe(true);
    expect(body.userIds).toHaveLength(2);
    expect(body.userIds).not.toContain(friendUserIds[0]);
    expect(body.userIds).toContain(friendUserIds[1]);
    expect(body.userIds).toContain(friendUserIds[2]);
    expect(body.next).toBeUndefined();
  });

  it("respects limit query parameter", async () => {
    const res = await app.request("/v2/bot/followers/ids?limit=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userIds).toHaveLength(1);
  });

  it("rejects limit > 1000 with 400", async () => {
    const res = await app.request("/v2/bot/followers/ids?limit=1001", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing bearer", async () => {
    const res = await app.request("/v2/bot/followers/ids");
    expect(res.status).toBe(401);
  });
});
