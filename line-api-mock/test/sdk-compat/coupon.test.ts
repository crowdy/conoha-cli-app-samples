import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messagingApi } from "@line/bot-sdk";
import {
  startSdkCompatServer,
  type SdkCompatHarness,
} from "./helpers/harness.js";

let harness: SdkCompatHarness;
let realCouponId: string;

beforeAll(async () => {
  harness = await startSdkCompatServer({
    channelId: "9200000001",
    channelName: "Coupon SDK Test",
    seedFriend: true,
    friendDisplayName: "SDK Coupon Tester",
    mountRouters: async (app) => {
      const { oauthRouter } = await import("../../src/mock/oauth.js");
      const { messageRouter } = await import("../../src/mock/message.js");
      const { couponRouter } = await import("../../src/mock/coupon.js");
      app.route("/", oauthRouter);
      app.route("/", couponRouter);
      app.route("/", messageRouter);
    },
  });

  // Create a coupon over raw HTTP (SDK lacks createCoupon in v9).
  const createRes = await fetch(
    `http://127.0.0.1:${harness.port}/v2/bot/coupon`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${harness.token}`,
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
    }
  );
  expect(createRes.status).toBe(200);
  realCouponId = (await createRes.json()).couponId;
}, 90_000);

afterAll(async () => {
  await harness.stop();
});

function sdkClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: harness.token,
    baseURL: `http://127.0.0.1:${harness.port}`,
  });
}

describe("@line/bot-sdk push coupon message against mock", () => {
  it("pushes a valid coupon message", async () => {
    const client = sdkClient();
    // SDK's typed Message union may not yet include "coupon"; cast to any.
    const res = await client.pushMessage({
      to: harness.botUserId!,
      messages: [{ type: "coupon", couponId: realCouponId } as any],
    });
    expect(res.sentMessages!.length).toBe(1);
  });

  it("fails when couponId is unknown", async () => {
    const client = sdkClient();
    await expect(
      client.pushMessage({
        to: harness.botUserId!,
        messages: [{ type: "coupon", couponId: "COUPON_nope" } as any],
      })
    ).rejects.toThrow();
  });
});
