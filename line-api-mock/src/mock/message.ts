import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { messages, virtualUsers, channelFriends, coupons } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { validate } from "./middleware/validate.js";
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

async function validateCouponMessages(
  channelDbId: number,
  msgs: Array<Record<string, unknown>>
): Promise<string | null> {
  for (const m of msgs) {
    if ((m as { type?: string }).type !== "coupon") continue;
    const cid = (m as { couponId?: unknown }).couponId;
    if (typeof cid !== "string" || cid.length === 0) {
      return "Invalid coupon message: couponId required";
    }
    const [c] = await db
      .select({ id: coupons.id })
      .from(coupons)
      .where(
        and(
          eq(coupons.couponId, cid),
          eq(coupons.channelId, channelDbId)
        )
      )
      .limit(1);
    if (!c) return `Invalid coupon ID: ${cid}`;
  }
  return null;
}

async function insertBotMessages(
  channelDbId: number,
  toUserId: string,
  msgs: Array<Record<string, unknown>>
): Promise<{ inserted: Array<{ id: string }>; error: string | null }> {
  const couponError = await validateCouponMessages(channelDbId, msgs);
  if (couponError) return { inserted: [], error: couponError };

  const userRows = await db
    .select({ id: virtualUsers.id })
    .from(virtualUsers)
    .where(eq(virtualUsers.userId, toUserId))
    .limit(1);
  if (userRows.length === 0) {
    return { inserted: [], error: "Invalid user ID" };
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
  return { inserted, error: null };
}

/**
 * POST /v2/bot/message/push
 */
messageRouter.post(
  "/v2/bot/message/push",
  validate({
    requestSchema: "#/components/schemas/PushMessageRequest",
    responseSchema: "#/components/schemas/PushMessageResponse",
  }),
  async (c) => {
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
  const result = await insertBotMessages(channelDbId, body.to, body.messages);
  if (result.error) {
    return errors.badRequest(c, result.error);
  }
  return c.json({ sentMessages: result.inserted });
  }
);

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
  const couponError = await validateCouponMessages(channelDbId, body.messages);
  if (couponError) return errors.badRequest(c, couponError);
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
    const result = await insertBotMessages(channelDbId, uid, body.messages);
    if (result.error && result.error.startsWith("Invalid coupon")) {
      return errors.badRequest(c, result.error);
    }
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
    const result = await insertBotMessages(channelDbId, f.userId, body.messages);
    if (result.error && result.error.startsWith("Invalid coupon")) {
      return errors.badRequest(c, result.error);
    }
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
  c.header("X-Line-Request-Id", reqId);
  return c.json({}, 202);
});

/**
 * GET /v2/bot/message/progress/narrowcast?requestId=...
 */
messageRouter.get("/v2/bot/message/progress/narrowcast", async (c) => {
  if (!c.req.query("requestId")) {
    return errors.badRequest(c, "requestId is required");
  }
  // Wire format is ISO 8601 string; @line/bot-sdk types declare `Date` but
  // the generated deserializer does not coerce. See issue #34 (M2) and the
  // SDK-compat pin in test/sdk-compat/narrowcast-progress.test.ts.
  return c.json({
    phase: "succeeded",
    successCount: 0,
    failureCount: 0,
    targetCount: 0,
    acceptedTime: new Date(0).toISOString(),
    completedTime: new Date(0).toISOString(),
  });
});
