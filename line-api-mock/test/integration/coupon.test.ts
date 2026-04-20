import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { couponRouter } = await import("../../src/mock/coupon.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9100000001",
      channelSecret: randomHex(16),
      name: "Coupon Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  app = new Hono();
  app.route("/", couponRouter);
}, 60_000);

afterAll(async () => container.stop());

function validPayload() {
  return {
    title: "10% OFF",
    description: "summer only",
    startTimestamp: Math.floor(Date.now() / 1000),
    endTimestamp: Math.floor(Date.now() / 1000) + 30 * 86400,
    maxUseCountPerTicket: 1,
    timezone: "ASIA_TOKYO",
    visibility: "UNLISTED",
    acquisitionCondition: { type: "normal" },
    reward: {
      type: "discount",
      priceInfo: { type: "percentage", percentage: 10 },
    },
  };
}

describe("POST /v2/bot/coupon", () => {
  it("creates a coupon and returns couponId", async () => {
    const res = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validPayload()),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.couponId).toBe("string");
    expect(json.couponId).toMatch(/^COUPON_/);
  });

  it("rejects missing bearer token", async () => {
    const res = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload()),
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid schema (missing title)", async () => {
    const p: any = validPayload();
    delete p.title;
    const res = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(p),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v2/bot/coupon/{couponId}", () => {
  it("returns coupon detail after creation", async () => {
    const createRes = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validPayload()),
    });
    const { couponId } = await createRes.json();

    const res = await app.request(`/v2/bot/coupon/${couponId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.couponId).toBe(couponId);
    expect(detail.title).toBe("10% OFF");
    expect(detail.status).toBe("RUNNING");
    expect(detail.reward.type).toBe("discount");
    expect(typeof detail.createdTimestamp).toBe("number");
  });

  it("returns 404 for unknown couponId", async () => {
    const res = await app.request("/v2/bot/coupon/COUPON_notfound", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v2/bot/coupon/{couponId} cross-channel isolation", () => {
  it("returns 404 when fetched with a token of a different channel", async () => {
    // Create a second channel with its own token.
    const { db } = await import("../../src/db/client.js");
    const { channels, accessTokens } = await import("../../src/db/schema.js");
    const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

    const [otherCh] = await db
      .insert(channels)
      .values({
        channelId: "9100000099",
        channelSecret: randomHex(16),
        name: "Other Channel",
      })
      .returning();
    const otherToken = accessTokenStr();
    await db.insert(accessTokens).values({
      channelId: otherCh.id,
      token: otherToken,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });

    // Create a coupon on the original channel.
    const createRes = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validPayload(), title: "owned by channel A" }),
    });
    const { couponId } = await createRes.json();

    // Fetch it with the OTHER channel's token — must 404.
    const res = await app.request(`/v2/bot/coupon/${couponId}`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v2/bot/coupon (list)", () => {
  it("returns items with couponId and title", async () => {
    const create = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validPayload(), title: "List me" }),
    });
    expect(create.status).toBe(200);

    const res = await app.request("/v2/bot/coupon", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const found = body.items.find((i: any) => i.title === "List me");
    expect(found).toBeDefined();
    expect(typeof found.couponId).toBe("string");
  });

  it("filters by status query", async () => {
    const res = await app.request("/v2/bot/coupon?status=CLOSED", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    for (const i of body.items) {
      expect(i.title).not.toBe("List me");
    }
  });
});

describe("PUT /v2/bot/coupon/{couponId}/close", () => {
  it("closes a RUNNING coupon and returns 200", async () => {
    const create = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validPayload(), title: "to close" }),
    });
    const { couponId } = await create.json();

    const closeRes = await app.request(
      `/v2/bot/coupon/${couponId}/close`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
      }
    );
    expect(closeRes.status).toBe(200);

    const detailRes = await app.request(`/v2/bot/coupon/${couponId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const detail = await detailRes.json();
    expect(detail.status).toBe("CLOSED");
  });

  it("rejects double-close with 400", async () => {
    const create = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validPayload(), title: "double close" }),
    });
    const { couponId } = await create.json();

    await app.request(`/v2/bot/coupon/${couponId}/close`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.request(
      `/v2/bot/coupon/${couponId}/close`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
      }
    );
    expect(second.status).toBe(400);
  });

  it("returns 404 for unknown couponId", async () => {
    const res = await app.request("/v2/bot/coupon/COUPON_missing/close", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
