import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { virtualUsers } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { errors } from "../lib/errors.js";

export const profileRouter = new Hono<{ Variables: AuthVars }>();
profileRouter.use("/v2/*", requestLog);
profileRouter.use("/v2/*", bearerAuth);

profileRouter.get("/v2/bot/profile/:userId", async (c) => {
  const userId = c.req.param("userId");
  const rows = await db
    .select()
    .from(virtualUsers)
    .where(eq(virtualUsers.userId, userId))
    .limit(1);
  if (rows.length === 0) return errors.notFound(c);
  const u = rows[0];
  return c.json({
    userId: u.userId,
    displayName: u.displayName,
    pictureUrl: u.pictureUrl ?? undefined,
    language: u.language,
  });
});
