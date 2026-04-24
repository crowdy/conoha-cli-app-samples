import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;
let channelDbId: number;
let richMenuIdA: string;
let richMenuIdB: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { LinearRouter } = await import("hono/router/linear-router");
  const { richMenuAliasRouter } = await import(
    "../../src/mock/rich-menu-alias.js"
  );
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, richMenus } = await import(
    "../../src/db/schema.js"
  );
  const { randomHex, accessTokenStr, richMenuId } = await import(
    "../../src/lib/id.js"
  );

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9500000101",
      channelSecret: randomHex(16),
      name: "Alias Test",
    })
    .returning();
  channelDbId = ch.id;
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  richMenuIdA = richMenuId();
  richMenuIdB = richMenuId();
  await db.insert(richMenus).values([
    { richMenuId: richMenuIdA, channelId: ch.id, payload: { name: "A" } },
    { richMenuId: richMenuIdB, channelId: ch.id, payload: { name: "B" } },
  ]);

  app = new Hono({ router: new LinearRouter() });
  app.route("/", richMenuAliasRouter);
}, 60_000);

afterAll(async () => container.stop());

function authHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

describe("rich menu alias", () => {
  it("creates an alias and returns 200", async () => {
    const res = await app.request("/v2/bot/richmenu/alias", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        richMenuAliasId: "richmenu-alias-a",
        richMenuId: richMenuIdA,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects duplicate aliasId with 400", async () => {
    const res = await app.request("/v2/bot/richmenu/alias", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        richMenuAliasId: "richmenu-alias-a",
        richMenuId: richMenuIdB,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("duplicate-create race: PG unique_violation surfaces as 400, not 500", async () => {
    // Seed the row directly via Drizzle to simulate a concurrent create
    // where both requests passed their existence check and only one INSERT
    // wins. Asserts the handler catches PG 23505 instead of letting it
    // propagate to app.onError as 500.
    const { db } = await import("../../src/db/client.js");
    const { richMenuAliases, richMenus } = await import(
      "../../src/db/schema.js"
    );
    const [rm] = await db
      .select({ id: richMenus.id })
      .from(richMenus)
      .limit(1);
    await db.insert(richMenuAliases).values({
      channelId: channelDbId,
      aliasId: "richmenu-alias-race",
      richMenuId: rm.id,
    });

    const res = await app.request("/v2/bot/richmenu/alias", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        richMenuAliasId: "richmenu-alias-race",
        richMenuId: richMenuIdA,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown richMenuId with 400", async () => {
    const res = await app.request("/v2/bot/richmenu/alias", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        richMenuAliasId: "richmenu-alias-unknown",
        richMenuId: "richmenu-0000000000000000000000000000ffff",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects aliasId violating pattern with 400", async () => {
    const res = await app.request("/v2/bot/richmenu/alias", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        richMenuAliasId: "UPPERCASE-BAD",
        richMenuId: richMenuIdA,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /alias/list returns the created aliases", async () => {
    const res = await app.request("/v2/bot/richmenu/alias/list", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.aliases)).toBe(true);
    const hit = json.aliases.find(
      (a: any) => a.richMenuAliasId === "richmenu-alias-a"
    );
    expect(hit).toBeDefined();
    expect(hit.richMenuId).toBe(richMenuIdA);
  });

  it("GET /alias/:aliasId returns the mapping", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-a",
      { headers: authHeaders() }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      richMenuAliasId: "richmenu-alias-a",
      richMenuId: richMenuIdA,
    });
  });

  it("GET /alias/:aliasId unknown returns 404", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-missing",
      { headers: authHeaders() }
    );
    expect(res.status).toBe(404);
  });

  it("POST /alias/:aliasId updates the target richMenuId", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-a",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ richMenuId: richMenuIdB }),
      }
    );
    expect(res.status).toBe(200);

    const get = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-a",
      { headers: authHeaders() }
    );
    const json = await get.json();
    expect(json.richMenuId).toBe(richMenuIdB);
  });

  it("POST /alias/:aliasId for unknown alias returns 400", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-missing",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ richMenuId: richMenuIdA }),
      }
    );
    expect(res.status).toBe(400);
  });

  it("POST /alias/:aliasId with unknown richMenuId returns 400", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-a",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          richMenuId: "richmenu-0000000000000000000000000000ffff",
        }),
      }
    );
    expect(res.status).toBe(400);
  });

  it("DELETE /alias/:aliasId removes the alias", async () => {
    // Create a disposable alias first so earlier tests remain stable.
    await app.request("/v2/bot/richmenu/alias", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        richMenuAliasId: "richmenu-alias-del",
        richMenuId: richMenuIdA,
      }),
    });
    const res = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-del",
      { method: "DELETE", headers: authHeaders() }
    );
    expect(res.status).toBe(200);

    const get = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-del",
      { headers: authHeaders() }
    );
    expect(get.status).toBe(404);
  });

  it("DELETE /alias/:aliasId for unknown alias returns 400", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-missing",
      { method: "DELETE", headers: authHeaders() }
    );
    expect(res.status).toBe(400);
  });

  it("channel isolation: alias from channel A is invisible to channel B", async () => {
    const { db } = await import("../../src/db/client.js");
    const { channels, accessTokens, richMenus, richMenuAliases } =
      await import("../../src/db/schema.js");
    const { randomHex, accessTokenStr, richMenuId } = await import(
      "../../src/lib/id.js"
    );

    const [chB] = await db
      .insert(channels)
      .values({
        channelId: "9500000102",
        channelSecret: randomHex(16),
        name: "Alias Test B",
      })
      .returning();
    const tokenB = accessTokenStr();
    await db.insert(accessTokens).values({
      channelId: chB.id,
      token: tokenB,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });

    // Channel B has its own richMenu
    const rmB = richMenuId();
    await db.insert(richMenus).values({
      richMenuId: rmB,
      channelId: chB.id,
      payload: { name: "B-only" },
    });

    const res = await app.request(
      "/v2/bot/richmenu/alias/richmenu-alias-a",
      {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokenB}`,
        },
      }
    );
    expect(res.status).toBe(404);

    const list = await app.request("/v2/bot/richmenu/alias/list", {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenB}`,
      },
    });
    const json = await list.json();
    expect(json.aliases).toEqual([]);
  });

  it("richMenu deletion cascades to alias", async () => {
    const { db } = await import("../../src/db/client.js");
    const { richMenus, richMenuAliases } = await import(
      "../../src/db/schema.js"
    );
    const { richMenuId } = await import("../../src/lib/id.js");
    const { eq } = await import("drizzle-orm");

    const cascadeRmId = richMenuId();
    const [rm] = await db
      .insert(richMenus)
      .values({
        richMenuId: cascadeRmId,
        channelId: channelDbId,
        payload: { name: "cascade-me" },
      })
      .returning();

    await app.request("/v2/bot/richmenu/alias", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        richMenuAliasId: "richmenu-alias-cascade",
        richMenuId: cascadeRmId,
      }),
    });

    await db.delete(richMenus).where(eq(richMenus.id, rm.id));

    const rows = await db
      .select()
      .from(richMenuAliases)
      .where(eq(richMenuAliases.aliasId, "richmenu-alias-cascade"));
    expect(rows).toEqual([]);
  });
});
