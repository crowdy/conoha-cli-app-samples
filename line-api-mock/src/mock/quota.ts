import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { messages } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";

export const quotaRouter = new Hono<{ Variables: AuthVars }>();
quotaRouter.use("/v2/*", requestLog);
quotaRouter.use("/v2/*", bearerAuth());

quotaRouter.get("/v2/bot/message/quota", (c) =>
  c.json({ type: "limited", value: 1000 })
);

quotaRouter.get("/v2/bot/message/quota/consumption", async (c) => {
  const channelDbId = c.get("channelDbId");
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.channelId, channelDbId),
        eq(messages.direction, "bot_to_user")
      )
    );
  return c.json({ totalUsage: count });
});
