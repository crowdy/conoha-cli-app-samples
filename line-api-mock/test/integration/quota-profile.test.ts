import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDb, type DbHandle } from "../helpers/testcontainer.js";

let container: DbHandle;
let app: any;
let token: string;
let userId: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { quotaRouter } = await import("../../src/mock/quota.js");
  const { profileRouter } = await import("../../src/mock/profile.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9000000004",
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
  userId = "U" + randomHex(16);
  const [u] = await db
    .insert(virtualUsers)
    .values({ userId, displayName: "tester", language: "ja" })
    .returning();
  await db.insert(channelFriends).values({ channelId: ch.id, userId: u.id });

  app = new Hono();
  app.route("/", quotaRouter);
  app.route("/", profileRouter);
}, 60_000);

afterAll(async () => container.stop());

it("GET /v2/bot/message/quota returns limited type", async () => {
  const res = await app.request("/v2/bot/message/quota", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ type: "limited", value: 1000 });
});

it("GET /v2/bot/message/quota/consumption returns totalUsage", async () => {
  const res = await app.request("/v2/bot/message/quota/consumption", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(typeof json.totalUsage).toBe("number");
});

it("GET /v2/bot/profile/:userId returns profile", async () => {
  const res = await app.request(`/v2/bot/profile/${userId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.userId).toBe(userId);
  expect(json.displayName).toBe("tester");
  expect(json.language).toBe("ja");
});

it("GET /v2/bot/profile/unknown returns 404", async () => {
  const res = await app.request("/v2/bot/profile/Udead", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(404);
});
