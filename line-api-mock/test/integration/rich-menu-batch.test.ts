import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
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

describe("rich menu batch", () => {
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
});
