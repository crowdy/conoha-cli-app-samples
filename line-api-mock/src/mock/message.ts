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

messageRouter.use("/v2/*", requestLog);
messageRouter.use("/v2/*", bearerAuth);

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

/**
 * POST /v2/bot/message/reply
 */
messageRouter.post("/v2/bot/message/reply", async (c) => {
  let body: { replyToken: string; messages: Array<Record<string, unknown>> };
  try {
    body = await c.req.json();
  } catch {
    return errors.badRequest(c, "Invalid JSON body");
  }
  if (!body.replyToken || !Array.isArray(body.messages) || body.messages.length === 0) {
    return errors.badRequest(c, "replyToken and messages are required");
  }
  const channelDbId = c.get("channelDbId");
  const userMsgRows = await db
    .select({ virtualUserId: messages.virtualUserId })
    .from(messages)
    .where(
      and(
        eq(messages.channelId, channelDbId),
        eq(messages.replyToken, body.replyToken)
      )
    )
    .limit(1);
  if (userMsgRows.length === 0) {
    return errors.badRequest(c, "Invalid reply token");
  }
  const virtualUserId = userMsgRows[0].virtualUserId;
  const inserted: Array<{ id: string }> = [];
  for (const m of body.messages) {
    const mid = messageId();
    const type = String((m as { type?: string }).type ?? "text");
    const [row] = await db
      .insert(messages)
      .values({
        messageId: mid,
        channelId: channelDbId,
        virtualUserId,
        direction: "bot_to_user",
        type,
        payload: m,
      })
      .returning({ id: messages.id });
    bus.emitEvent({
      type: "message.inserted",
      channelId: channelDbId,
      virtualUserId,
      id: row.id,
    });
    inserted.push({ id: mid });
  }
  return c.json({ sentMessages: inserted });
});

/**
 * POST /v2/bot/message/multicast
 */
messageRouter.post("/v2/bot/message/multicast", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { to: string[]; messages: Array<Record<string, unknown>> }
    | null;
  if (!body || !Array.isArray(body.to) || !Array.isArray(body.messages)) {
    return errors.badRequest(c, "to[] and messages[] are required");
  }
  if (body.to.length > 500) return errors.badRequest(c, "to must be <= 500");
  const channelDbId = c.get("channelDbId");
  for (const uid of body.to) {
    await insertBotMessages(channelDbId, uid, body.messages);
  }
  return c.json({});
});

/**
 * POST /v2/bot/message/broadcast
 */
messageRouter.post("/v2/bot/message/broadcast", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { messages: Array<Record<string, unknown>> }
    | null;
  if (!body || !Array.isArray(body.messages)) {
    return errors.badRequest(c, "messages[] is required");
  }
  const channelDbId = c.get("channelDbId");
  const friends = await db
    .select({ userId: virtualUsers.userId })
    .from(channelFriends)
    .innerJoin(virtualUsers, eq(channelFriends.userId, virtualUsers.id))
    .where(
      and(
        eq(channelFriends.channelId, channelDbId),
        eq(channelFriends.blocked, false)
      )
    );
  for (const f of friends) {
    await insertBotMessages(channelDbId, f.userId, body.messages);
  }
  return c.json({});
});

/**
 * POST /v2/bot/message/narrowcast (stub)
 * Returns 202 Accepted with a request id; progress endpoint always succeeds.
 */
messageRouter.post("/v2/bot/message/narrowcast", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { messages?: Array<Record<string, unknown>> }
    | null;
  if (!body || !Array.isArray(body.messages)) {
    return errors.badRequest(c, "messages[] is required");
  }
  const reqId = (
    Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  ).slice(0, 32);
  return c.body(null, 202, { "X-Line-Request-Id": reqId });
});

/**
 * GET /v2/bot/message/progress/narrowcast?requestId=...
 */
messageRouter.get("/v2/bot/message/progress/narrowcast", async (c) => {
  return c.json({
    phase: "succeeded",
    successCount: 0,
    failureCount: 0,
    targetCount: 0,
  });
});
