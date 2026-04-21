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
