import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { messagingApi } from "@line/bot-sdk";
import { startDb, type DbHandle } from "../helpers/testcontainer.js";

let container: DbHandle;
let server: ServerType;
let port: number;
let token: string;
let botUserId: string;
let realCouponId: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { oauthRouter } = await import("../../src/mock/oauth.js");
  const { messageRouter } = await import("../../src/mock/message.js");
  const { couponRouter } = await import("../../src/mock/coupon.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9200000001",
      channelSecret: randomHex(16),
      name: "Coupon SDK Test",
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
    .values({ userId: botUserId, displayName: "SDK Coupon Tester" })
    .returning();
  await db
    .insert(channelFriends)
    .values({ channelId: ch.id, userId: u.id });

  const app = new Hono();
  app.route("/", oauthRouter);
  app.route("/", couponRouter);
  app.route("/", messageRouter);

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });

  // Create a coupon over raw HTTP (SDK lacks createCoupon in v9).
  const createRes = await fetch(`http://127.0.0.1:${port}/v2/bot/coupon`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: "SDK coupon",
      startTimestamp: Math.floor(Date.now() / 1000),
      endTimestamp: Math.floor(Date.now() / 1000) + 86400,
      maxUseCountPerTicket: 1,
      timezone: "ASIA_TOKYO",
      visibility: "UNLISTED",
      acquisitionCondition: { type: "normal" },
      reward: {
        type: "discount",
        priceInfo: { type: "percentage", percentage: 15 },
      },
    }),
  });
  expect(createRes.status).toBe(200);
  realCouponId = (await createRes.json()).couponId;
}, 90_000);

afterAll(async () => {
  server?.close();
  await container.stop();
});

function sdkClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: token,
    baseURL: `http://127.0.0.1:${port}`,
  });
}

describe("@line/bot-sdk push coupon message against mock", () => {
  it("pushes a valid coupon message", async () => {
    const client = sdkClient();
    // SDK's typed Message union may not yet include "coupon"; cast to any.
    const res = await client.pushMessage({
      to: botUserId,
      messages: [{ type: "coupon", couponId: realCouponId } as any],
    });
    expect(res.sentMessages!.length).toBe(1);
  });

  it("fails when couponId is unknown", async () => {
    const client = sdkClient();
    await expect(
      client.pushMessage({
        to: botUserId,
        messages: [{ type: "coupon", couponId: "COUPON_nope" } as any],
      })
    ).rejects.toThrow();
  });
});
