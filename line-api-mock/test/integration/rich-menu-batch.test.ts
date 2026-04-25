import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startDb, type DbHandle } from "../helpers/testcontainer.js";

let container: DbHandle;
let app: any;
let token: string;
let channelDbId: number;
let rmA: string;
let rmB: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { LinearRouter } = await import("hono/router/linear-router");
  const { richMenuBatchRouter } = await import(
    "../../src/mock/rich-menu-batch.js"
  );
  const { db } = await import("../../src/db/client.js");
  const {
    channels,
    accessTokens,
    richMenus,
    virtualUsers,
    channelFriends,
    userRichMenuLinks,
  } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr, richMenuId } = await import(
    "../../src/lib/id.js"
  );

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9500000201",
      channelSecret: randomHex(16),
      name: "Batch Test",
    })
    .returning();
  channelDbId = ch.id;
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  rmA = richMenuId();
  rmB = richMenuId();
  const [menuA] = await db
    .insert(richMenus)
    .values({ richMenuId: rmA, channelId: ch.id, payload: { name: "A" } })
    .returning();
  const [menuB] = await db
    .insert(richMenus)
    .values({ richMenuId: rmB, channelId: ch.id, payload: { name: "B" } })
    .returning();

  userA = "U" + randomHex(16);
  userB = "U" + randomHex(16);
  const [uA] = await db
    .insert(virtualUsers)
    .values({ userId: userA, displayName: "BatchA" })
    .returning();
  const [uB] = await db
    .insert(virtualUsers)
    .values({ userId: userB, displayName: "BatchB" })
    .returning();
  await db.insert(channelFriends).values([
    { channelId: ch.id, userId: uA.id },
    { channelId: ch.id, userId: uB.id },
  ]);

  // Seed: both users linked to rmA
  await db.insert(userRichMenuLinks).values([
    { channelId: ch.id, userId: uA.id, richMenuId: menuA.id },
    { channelId: ch.id, userId: uB.id, richMenuId: menuA.id },
  ]);

  app = new Hono({ router: new LinearRouter() });
  app.route("/", richMenuBatchRouter);
}, 60_000);

beforeEach(async () => {
  // Reset user links to baseline: both users → rmA
  const { db } = await import("../../src/db/client.js");
  const { userRichMenuLinks, virtualUsers, richMenus } = await import(
    "../../src/db/schema.js"
  );
  const { eq } = await import("drizzle-orm");
  await db
    .delete(userRichMenuLinks)
    .where(eq(userRichMenuLinks.channelId, channelDbId));
  const [uA] = await db
    .select()
    .from(virtualUsers)
    .where(eq(virtualUsers.userId, userA));
  const [uB] = await db
    .select()
    .from(virtualUsers)
    .where(eq(virtualUsers.userId, userB));
  const [menuA] = await db
    .select()
    .from(richMenus)
    .where(eq(richMenus.richMenuId, rmA));
  await db.insert(userRichMenuLinks).values([
    { channelId: channelDbId, userId: uA.id, richMenuId: menuA.id },
    { channelId: channelDbId, userId: uB.id, richMenuId: menuA.id },
  ]);
});

afterAll(async () => container.stop());

function authHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

// Tests here rely on the beforeEach baseline reset to start from a known
// state. Marked sequential so `--sequence.concurrent` can't interleave
// baseline setup with the next test's assertions. Note: this does NOT
// guard against `--sequence.shuffle` in Vitest 2.x. See issue #37.
describe.sequential("rich menu batch", () => {
  it("POST /validate/batch accepts valid shape with 200", async () => {
    const res = await app.request("/v2/bot/richmenu/validate/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [
          { type: "link", from: rmA, to: rmB },
          { type: "unlink", from: rmA },
          { type: "unlinkAll" },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /validate/batch rejects missing type", async () => {
    const res = await app.request("/v2/bot/richmenu/validate/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ from: rmA }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /validate/batch rejects empty operations array", async () => {
    const res = await app.request("/v2/bot/richmenu/validate/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ operations: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /batch link replaces from→to and returns 202 with request id", async () => {
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "link", from: rmA, to: rmB }],
      }),
    });
    expect(res.status).toBe(202);
    expect(res.headers.get("x-line-request-id")).toMatch(/^[0-9a-f]{32}$/);

    // Verify DB state: both users now point to rmB
    const { db } = await import("../../src/db/client.js");
    const { userRichMenuLinks, richMenus } = await import(
      "../../src/db/schema.js"
    );
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ rid: richMenus.richMenuId })
      .from(userRichMenuLinks)
      .innerJoin(richMenus, eq(userRichMenuLinks.richMenuId, richMenus.id))
      .where(eq(userRichMenuLinks.channelId, channelDbId));
    expect(rows.every((r) => r.rid === rmB)).toBe(true);
    expect(rows.length).toBe(2);
  });

  it("POST /batch unlink removes all links for `from`", async () => {
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "unlink", from: rmA }],
      }),
    });
    expect(res.status).toBe(202);
    const { db } = await import("../../src/db/client.js");
    const { userRichMenuLinks } = await import("../../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(userRichMenuLinks)
      .where(eq(userRichMenuLinks.channelId, channelDbId));
    expect(rows).toEqual([]);
  });

  it("POST /batch unlinkAll removes every user link in channel", async () => {
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "unlinkAll" }],
      }),
    });
    expect(res.status).toBe(202);
    const { db } = await import("../../src/db/client.js");
    const { userRichMenuLinks } = await import("../../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(userRichMenuLinks)
      .where(eq(userRichMenuLinks.channelId, channelDbId));
    expect(rows).toEqual([]);
  });

  it("POST /batch silently skips unknown `from` richMenuId", async () => {
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [
          {
            type: "unlink",
            from: "richmenu-0000000000000000000000000000ffff",
          },
        ],
      }),
    });
    expect(res.status).toBe(202);
    // Baseline still intact: 2 links to rmA
    const { db } = await import("../../src/db/client.js");
    const { userRichMenuLinks } = await import("../../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(userRichMenuLinks)
      .where(eq(userRichMenuLinks.channelId, channelDbId));
    expect(rows.length).toBe(2);
  });

  it("POST /batch applies multiple operations in order", async () => {
    // [link rmA→rmB, unlink rmA]:
    //   sequential order: link first moves both to rmB, then unlink rmA is a no-op → 2 rows at rmB
    //   reversed order would: unlink rmA wipes both, then link is a no-op → 0 rows
    // Distinct end states pin down ordering.
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [
          { type: "link", from: rmA, to: rmB },
          { type: "unlink", from: rmA },
        ],
      }),
    });
    expect(res.status).toBe(202);
    const { db } = await import("../../src/db/client.js");
    const { userRichMenuLinks, richMenus } = await import("../../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ rid: richMenus.richMenuId })
      .from(userRichMenuLinks)
      .innerJoin(richMenus, eq(userRichMenuLinks.richMenuId, richMenus.id))
      .where(eq(userRichMenuLinks.channelId, channelDbId));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.rid === rmB)).toBe(true);
  });

  it("POST /batch silently skips link with unknown from/to", async () => {
    const bogus = "richmenu-0000000000000000000000000000beef";
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [
          { type: "link", from: bogus, to: rmB },
          { type: "link", from: rmA, to: bogus },
        ],
      }),
    });
    expect(res.status).toBe(202);
    // Baseline still intact: both users still linked to rmA
    const { db } = await import("../../src/db/client.js");
    const { userRichMenuLinks, richMenus } = await import("../../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ rid: richMenus.richMenuId })
      .from(userRichMenuLinks)
      .innerJoin(richMenus, eq(userRichMenuLinks.richMenuId, richMenus.id))
      .where(eq(userRichMenuLinks.channelId, channelDbId));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.rid === rmA)).toBe(true);
  });

  it("POST /batch rejects empty operations with 400", async () => {
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ operations: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /progress/batch returns succeeded phase", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/progress/batch?requestId=abc123",
      { headers: authHeaders() }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.phase).toBe("succeeded");
    expect(typeof json.acceptedTime).toBe("string");
    expect(typeof json.completedTime).toBe("string");
  });

  it("GET /progress/batch without requestId returns 400", async () => {
    const res = await app.request("/v2/bot/richmenu/progress/batch", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("POST /validate/batch rejects link operation missing `to`", async () => {
    const res = await app.request("/v2/bot/richmenu/validate/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "link", from: rmA }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /validate/batch rejects link operation missing `from`", async () => {
    const res = await app.request("/v2/bot/richmenu/validate/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "link", to: rmB }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /validate/batch rejects unlink operation missing `from`", async () => {
    const res = await app.request("/v2/bot/richmenu/validate/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "unlink" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /batch rejects malformed link operation", async () => {
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "link", from: rmA }],
      }),
    });
    expect(res.status).toBe(400);
    // Baseline intact (handler must 400 BEFORE applying any op)
    const { db } = await import("../../src/db/client.js");
    const { userRichMenuLinks } = await import("../../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(userRichMenuLinks)
      .where(eq(userRichMenuLinks.channelId, channelDbId));
    expect(rows.length).toBe(2);
  });

  it("POST /batch rejects malformed unlink operation", async () => {
    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "unlink" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /batch silently skips foreign-channel richMenuId", async () => {
    // Seed a second channel with its own richMenu. The batch request is
    // authenticated as channel A, so even if channel B's richMenuId happens
    // to leak into operations[], channel A's links must not move.
    const { db } = await import("../../src/db/client.js");
    const { channels, richMenus, userRichMenuLinks } = await import(
      "../../src/db/schema.js"
    );
    const { randomHex, richMenuId } = await import("../../src/lib/id.js");
    const { eq } = await import("drizzle-orm");

    const [chB] = await db
      .insert(channels)
      .values({
        channelId: "9500000299",
        channelSecret: randomHex(16),
        name: "Batch Isolation B",
      })
      .returning();
    const foreignRm = richMenuId();
    await db.insert(richMenus).values({
      richMenuId: foreignRm,
      channelId: chB.id,
      payload: { name: "foreign" },
    });

    const res = await app.request("/v2/bot/richmenu/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        operations: [{ type: "unlink", from: foreignRm }],
      }),
    });
    expect(res.status).toBe(202);

    // Baseline intact: 2 links in channel A
    const rows = await db
      .select()
      .from(userRichMenuLinks)
      .where(eq(userRichMenuLinks.channelId, channelDbId));
    expect(rows.length).toBe(2);
  });
});
