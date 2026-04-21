import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db/client.js";
import { channels, channelFriends, virtualUsers } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { errors } from "../lib/errors.js";

export const botInfoRouter = new Hono<{ Variables: AuthVars }>();
botInfoRouter.use("/v2/bot/info", requestLog);
botInfoRouter.use("/v2/bot/info", bearerAuth);
botInfoRouter.use("/v2/bot/followers/*", requestLog);
botInfoRouter.use("/v2/bot/followers/*", bearerAuth);

function deriveBotUserId(channelId: string): string {
  return "U" + createHash("sha256").update(channelId).digest("hex").slice(0, 32);
}

botInfoRouter.get("/v2/bot/info", async (c) => {
  const channelDbId = c.get("channelDbId");
  const [ch] = await db
    .select({
      channelId: channels.channelId,
      name: channels.name,
    })
    .from(channels)
    .where(eq(channels.id, channelDbId))
    .limit(1);
  if (!ch) return errors.notFound(c);
  return c.json({
    userId: deriveBotUserId(ch.channelId),
    basicId: "@" + ch.channelId.slice(0, 8),
    displayName: ch.name,
    chatMode: "chat",
    markAsReadMode: "manual",
  });
});

botInfoRouter.get("/v2/bot/followers/ids", async (c) => {
  const channelDbId = c.get("channelDbId");
  const limitStr = c.req.query("limit");
  let limit = 300;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      return errors.badRequest(c, "limit must be an integer in [1, 1000]");
    }
    limit = n;
  }
  const rows = await db
    .select({ userId: virtualUsers.userId })
    .from(channelFriends)
    .innerJoin(virtualUsers, eq(channelFriends.userId, virtualUsers.id))
    .where(
      and(
        eq(channelFriends.channelId, channelDbId),
        eq(channelFriends.blocked, false)
      )
    )
    .limit(limit);
  return c.json({ userIds: rows.map((r) => r.userId) });
});
