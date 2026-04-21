import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  channels,
  channelFriends,
  richMenus,
  richMenuImages,
  userRichMenuLinks,
  virtualUsers,
} from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { errors } from "../lib/errors.js";

export const richMenuLinkRouter = new Hono<{ Variables: AuthVars }>();

richMenuLinkRouter.use("/v2/bot/user/*", requestLog);
richMenuLinkRouter.use("/v2/bot/user/*", bearerAuth);

async function findRichMenuWithImage(
  channelDbId: number,
  richMenuIdStr: string
): Promise<{ internalId: number } | { error: "notfound" | "no_image" }> {
  const [row] = await db
    .select({
      internalId: richMenus.id,
      hasImage: richMenuImages.richMenuId,
    })
    .from(richMenus)
    .leftJoin(richMenuImages, eq(richMenus.id, richMenuImages.richMenuId))
    .where(
      and(
        eq(richMenus.richMenuId, richMenuIdStr),
        eq(richMenus.channelId, channelDbId)
      )
    )
    .limit(1);
  if (!row) return { error: "notfound" };
  if (row.hasImage === null) return { error: "no_image" };
  return { internalId: row.internalId };
}

async function findVirtualUser(
  channelDbId: number,
  userIdStr: string
): Promise<{ id: number } | null> {
  // Only resolve users that are actually friends of this channel. LINE's real
  // API rejects links to non-friend users; we mirror that boundary here.
  const [row] = await db
    .select({ id: virtualUsers.id })
    .from(virtualUsers)
    .innerJoin(
      channelFriends,
      and(
        eq(channelFriends.userId, virtualUsers.id),
        eq(channelFriends.channelId, channelDbId)
      )
    )
    .where(eq(virtualUsers.userId, userIdStr))
    .limit(1);
  return row ? { id: row.id } : null;
}

// === Default: set / get / unset ===
// IMPORTANT: These must be registered BEFORE per-user handlers so that
// the literal segment "all" is not captured as :userId.

richMenuLinkRouter.post(
  "/v2/bot/user/all/richmenu/:richMenuId",
  async (c) => {
    const richMenuIdStr = c.req.param("richMenuId");
    const channelDbId = c.get("channelDbId");
    const rm = await findRichMenuWithImage(channelDbId, richMenuIdStr);
    if ("error" in rm) {
      if (rm.error === "notfound") return errors.notFound(c);
      return errors.badRequest(c, "Rich menu has no uploaded image");
    }
    await db
      .update(channels)
      .set({ defaultRichMenuId: rm.internalId })
      .where(eq(channels.id, channelDbId));
    return c.json({});
  }
);

richMenuLinkRouter.get("/v2/bot/user/all/richmenu", async (c) => {
  const channelDbId = c.get("channelDbId");
  const [row] = await db
    .select({
      defaultId: channels.defaultRichMenuId,
    })
    .from(channels)
    .where(eq(channels.id, channelDbId))
    .limit(1);
  if (!row || row.defaultId === null) return errors.notFound(c);
  const [rm] = await db
    .select({ richMenuIdStr: richMenus.richMenuId })
    .from(richMenus)
    .where(eq(richMenus.id, row.defaultId))
    .limit(1);
  if (!rm) return errors.notFound(c);
  return c.json({ richMenuId: rm.richMenuIdStr });
});

richMenuLinkRouter.delete("/v2/bot/user/all/richmenu", async (c) => {
  const channelDbId = c.get("channelDbId");
  await db
    .update(channels)
    .set({ defaultRichMenuId: null })
    .where(eq(channels.id, channelDbId));
  return c.json({});
});

// === Per-user: link / get / unlink ===

richMenuLinkRouter.post(
  "/v2/bot/user/:userId/richmenu/:richMenuId",
  async (c) => {
    const userIdStr = c.req.param("userId");
    const richMenuIdStr = c.req.param("richMenuId");
    const channelDbId = c.get("channelDbId");

    const rm = await findRichMenuWithImage(channelDbId, richMenuIdStr);
    if ("error" in rm) {
      if (rm.error === "notfound") return errors.notFound(c);
      return errors.badRequest(c, "Rich menu has no uploaded image");
    }

    const u = await findVirtualUser(channelDbId, userIdStr);
    if (!u) return errors.notFound(c);

    await db
      .delete(userRichMenuLinks)
      .where(
        and(
          eq(userRichMenuLinks.channelId, channelDbId),
          eq(userRichMenuLinks.userId, u.id)
        )
      );
    await db.insert(userRichMenuLinks).values({
      channelId: channelDbId,
      userId: u.id,
      richMenuId: rm.internalId,
    });
    return c.json({});
  }
);

richMenuLinkRouter.get("/v2/bot/user/:userId/richmenu", async (c) => {
  const userIdStr = c.req.param("userId");
  const channelDbId = c.get("channelDbId");
  const rows = await db
    .select({ richMenuIdStr: richMenus.richMenuId })
    .from(userRichMenuLinks)
    .innerJoin(virtualUsers, eq(userRichMenuLinks.userId, virtualUsers.id))
    .innerJoin(richMenus, eq(userRichMenuLinks.richMenuId, richMenus.id))
    .where(
      and(
        eq(userRichMenuLinks.channelId, channelDbId),
        eq(virtualUsers.userId, userIdStr)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return errors.notFound(c);
  return c.json({ richMenuId: row.richMenuIdStr });
});

richMenuLinkRouter.delete("/v2/bot/user/:userId/richmenu", async (c) => {
  const userIdStr = c.req.param("userId");
  const channelDbId = c.get("channelDbId");
  const u = await findVirtualUser(channelDbId, userIdStr);
  if (!u) return errors.notFound(c);
  await db
    .delete(userRichMenuLinks)
    .where(
      and(
        eq(userRichMenuLinks.channelId, channelDbId),
        eq(userRichMenuLinks.userId, u.id)
      )
    );
  return c.json({});
});

richMenuLinkRouter.post("/v2/bot/richmenu/bulk/link", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { richMenuId?: string; userIds?: string[] }
    | null;
  if (!body || typeof body.richMenuId !== "string" || !Array.isArray(body.userIds)) {
    return errors.badRequest(c, "richMenuId and userIds are required");
  }
  if (body.userIds.length < 1 || body.userIds.length > 500) {
    return errors.badRequest(c, "userIds length must be 1..500");
  }
  const channelDbId = c.get("channelDbId");
  const rm = await findRichMenuWithImage(channelDbId, body.richMenuId);
  if ("error" in rm) {
    if (rm.error === "notfound") return errors.badRequest(c, "Unknown rich menu");
    return errors.badRequest(c, "Rich menu has no uploaded image");
  }

  for (const uid of body.userIds) {
    const u = await findVirtualUser(channelDbId, uid);
    if (!u) continue;
    await db
      .delete(userRichMenuLinks)
      .where(
        and(
          eq(userRichMenuLinks.channelId, channelDbId),
          eq(userRichMenuLinks.userId, u.id)
        )
      );
    await db.insert(userRichMenuLinks).values({
      channelId: channelDbId,
      userId: u.id,
      richMenuId: rm.internalId,
    });
  }
  return c.body(null, 202);
});

richMenuLinkRouter.post("/v2/bot/richmenu/bulk/unlink", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { userIds?: string[] }
    | null;
  if (!body || !Array.isArray(body.userIds)) {
    return errors.badRequest(c, "userIds is required");
  }
  if (body.userIds.length < 1 || body.userIds.length > 500) {
    return errors.badRequest(c, "userIds length must be 1..500");
  }
  const channelDbId = c.get("channelDbId");
  for (const uid of body.userIds) {
    const u = await findVirtualUser(channelDbId, uid);
    if (!u) continue;
    await db
      .delete(userRichMenuLinks)
      .where(
        and(
          eq(userRichMenuLinks.channelId, channelDbId),
          eq(userRichMenuLinks.userId, u.id)
        )
      );
  }
  return c.body(null, 202);
});
