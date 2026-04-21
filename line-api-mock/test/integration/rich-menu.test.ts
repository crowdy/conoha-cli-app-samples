import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { richMenuRouter } = await import("../../src/mock/rich-menu.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9500000001",
      channelSecret: randomHex(16),
      name: "RichMenu Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  app = new Hono();
  app.route("/", richMenuRouter);
}, 60_000);

afterAll(async () => container.stop());

export function validRichMenuBody() {
  return {
    size: { width: 2500, height: 1686 },
    selected: false,
    name: "Test menu",
    chatBarText: "Menu",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 1250, height: 1686 },
        action: { type: "postback", data: "a=1" },
      },
    ],
  };
}

describe("POST /v2/bot/richmenu", () => {
  it("creates a rich menu and returns richMenuId", async () => {
    const res = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validRichMenuBody()),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.richMenuId).toMatch(/^richmenu-[0-9a-f]{32}$/);
  });

  it("rejects missing chatBarText with 400", async () => {
    const body: any = validRichMenuBody();
    delete body.chatBarText;
    const res = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing bearer with 401", async () => {
    const res = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validRichMenuBody()),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /v2/bot/richmenu/validate", () => {
  it("returns 200 on valid body", async () => {
    const res = await app.request("/v2/bot/richmenu/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validRichMenuBody()),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("returns 400 on invalid body", async () => {
    const res = await app.request("/v2/bot/richmenu/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ size: { width: "nope" } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v2/bot/richmenu/:richMenuId", () => {
  it("returns the created rich menu", async () => {
    const createRes = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validRichMenuBody()),
    });
    const { richMenuId } = await createRes.json();

    const res = await app.request(`/v2/bot/richmenu/${richMenuId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.richMenuId).toBe(richMenuId);
    expect(body.size.width).toBe(2500);
    expect(body.name).toBe("Test menu");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/v2/bot/richmenu/richmenu-0000", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v2/bot/richmenu/list", () => {
  it("returns all rich menus for the channel", async () => {
    const res = await app.request("/v2/bot/richmenu/list", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.richmenus)).toBe(true);
    expect(body.richmenus.length).toBeGreaterThanOrEqual(1);
    expect(body.richmenus[0].richMenuId).toMatch(/^richmenu-[0-9a-f]{32}$/);
  });
});

describe("DELETE /v2/bot/richmenu/:richMenuId", () => {
  it("deletes and returns 200, subsequent GET is 404", async () => {
    const create = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "to-delete" }),
    });
    const { richMenuId } = await create.json();

    const del = await app.request(`/v2/bot/richmenu/${richMenuId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(200);

    const get = await app.request(`/v2/bot/richmenu/${richMenuId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.status).toBe(404);
  });
});

describe("GET /v2/bot/richmenu/:richMenuId cross-channel isolation", () => {
  it("returns 404 when fetched with a token of a different channel", async () => {
    const { db } = await import("../../src/db/client.js");
    const { channels, accessTokens } = await import("../../src/db/schema.js");
    const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

    // Create channel B with its own token.
    const [otherCh] = await db
      .insert(channels)
      .values({
        channelId: "9500000099",
        channelSecret: randomHex(16),
        name: "Other RichMenu Channel",
      })
      .returning();
    const otherToken = accessTokenStr();
    await db.insert(accessTokens).values({
      channelId: otherCh.id,
      token: otherToken,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });

    // Create a rich menu on channel A.
    const createRes = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "owned by A" }),
    });
    const { richMenuId } = await createRes.json();

    // Fetch with channel B's token → must 404.
    const getRes = await app.request(`/v2/bot/richmenu/${richMenuId}`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(getRes.status).toBe(404);

    // DELETE with channel B's token → must 404 too.
    const delRes = await app.request(`/v2/bot/richmenu/${richMenuId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(delRes.status).toBe(404);
  });
});

// Minimal valid PNG (1x1 transparent) for testing.
const PNG_1x1 = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415408996360000000000500010D0A2DB40000000049454E44AE426082",
  "hex"
);

describe("Rich menu image upload/download", () => {
  let id: string;
  beforeAll(async () => {
    const create = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "image-host" }),
    });
    const body = await create.json();
    id = body.richMenuId;
  });

  it("accepts PNG upload and serves it back with same bytes", async () => {
    const up = await app.request(`/v2/bot/richmenu/${id}/content`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        authorization: `Bearer ${token}`,
      },
      body: PNG_1x1,
    });
    expect(up.status).toBe(200);

    const down = await app.request(`/v2/bot/richmenu/${id}/content`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(down.status).toBe(200);
    expect(down.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await down.arrayBuffer());
    expect(bytes.equals(PNG_1x1)).toBe(true);
  });

  it("rejects non-image content-type with 400", async () => {
    const res = await app.request(`/v2/bot/richmenu/${id}/content`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        authorization: `Bearer ${token}`,
      },
      body: Buffer.from("hello"),
    });
    expect(res.status).toBe(400);
  });

  it("rejects upload > 1 MB with 400", async () => {
    const big = Buffer.alloc(1_048_577, 0);
    const res = await app.request(`/v2/bot/richmenu/${id}/content`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        authorization: `Bearer ${token}`,
      },
      body: big,
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 downloading image of unknown rich menu", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/richmenu-0000000000000000000000000000/content",
      { headers: { authorization: `Bearer ${token}` } }
    );
    expect(res.status).toBe(404);
  });
});
