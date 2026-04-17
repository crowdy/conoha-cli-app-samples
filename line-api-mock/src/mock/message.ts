import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { messages, virtualUsers, channelFriends } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { messageId, replyToken } from "../lib/id.js";
import { bus } from "../lib/events.js";
import { errors } from "../lib/errors.js";

export const messageRouter = new Hono<{ Variables: AuthVars }>();

messageRouter.use("*", requestLog);
messageRouter.use("*", bearerAuth);

interface PushBody {
  to: string;
  messages: Array<Record<string, unknown>>;
  notificationDisabled?: boolean;
}

async function insertBotMessages(
  channelDbId: number,
  toUserId: string,
  msgs: Array<Record<string, unknown>>
): Promise<Array<{ id: string }>> {
  const userRows = await db
    .select({ id: virtualUsers.id })
    .from(virtualUsers)
    .where(eq(virtualUsers.userId, toUserId))
    .limit(1);
  if (userRows.length === 0) {
    // Mirror LINE: unknown user → 400-ish; real API returns 400 "Invalid user ID".
    return [];
  }
  const vuid = userRows[0].id;
  const inserted: Array<{ id: string }> = [];
  for (const m of msgs) {
    const mid = messageId();
    const type = String((m as { type?: string }).type ?? "text");
    const [row] = await db
      .insert(messages)
      .values({
        messageId: mid,
        channelId: channelDbId,
        virtualUserId: vuid,
        direction: "bot_to_user",
        type,
        payload: m,
      })
      .returning({ id: messages.id });
    bus.emitEvent({
      type: "message.inserted",
      channelId: channelDbId,
      virtualUserId: vuid,
      id: row.id,
    });
    inserted.push({ id: mid });
  }
  return inserted;
}

/**
 * POST /v2/bot/message/push
 */
messageRouter.post("/v2/bot/message/push", async (c) => {
  let body: PushBody;
  try {
    body = (await c.req.json()) as PushBody;
  } catch {
    return errors.badRequest(c, "Invalid JSON body");
  }
  if (!body.to || !Array.isArray(body.messages) || body.messages.length === 0) {
    return errors.badRequest(c, "The property, 'to' and 'messages' must be specified.");
  }
  if (body.messages.length > 5) {
    return errors.badRequest(c, "messages must not exceed 5 items");
  }
  const channelDbId = c.get("channelDbId");
  const inserted = await insertBotMessages(channelDbId, body.to, body.messages);
  if (inserted.length === 0) {
    return errors.badRequest(c, "Invalid user ID");
  }
  return c.json({ sentMessages: inserted });
});
