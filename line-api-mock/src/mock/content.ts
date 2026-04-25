import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { messages, messageContents } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { errors } from "../lib/errors.js";

export const contentRouter = new Hono<{ Variables: AuthVars }>();
contentRouter.use("/v2/*", requestLog);
contentRouter.use("/v2/*", bearerAuth);

contentRouter.get("/v2/bot/message/:messageId/content", async (c) => {
  const mid = c.req.param("messageId");
  const rows = await db
    .select({
      id: messages.id,
      contentType: messageContents.contentType,
      data: messageContents.data,
    })
    .from(messages)
    .leftJoin(messageContents, eq(messages.id, messageContents.messageId))
    .where(eq(messages.messageId, mid))
    .limit(1);
  const row = rows[0];
  if (!row || !row.data || !row.contentType) return errors.notFound(c);
  c.header("Content-Type", row.contentType);
  return c.body(new Uint8Array(row.data));
});

contentRouter.get(
  "/v2/bot/message/:messageId/content/transcoding",
  (c) => c.json({ status: "succeeded" })
);
