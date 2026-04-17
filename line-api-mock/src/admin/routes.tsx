import { Hono } from "hono";
import { sql, eq, inArray, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels, messages, webhookDeliveries, accessTokens, virtualUsers, apiLogs } from "../db/schema.js";
import { adminAuth } from "./auth.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Channels } from "./pages/Channels.js";
import { Users } from "./pages/Users.js";
import { Conversation } from "./pages/Conversation.js";
import { WebhookLog } from "./pages/WebhookLog.js";
import { ApiLog } from "./pages/ApiLog.js";
import { accessTokenStr, randomHex, messageId, replyToken } from "../lib/id.js";
import { config } from "../config.js";
import { sseHandler } from "./sse.js";
import { dispatchWebhook } from "../webhook/dispatcher.js";
import { bus } from "../lib/events.js";
import { checkWebhookUrl } from "../webhook/url-policy.js";

export const adminRouter = new Hono();
adminRouter.use("*", adminAuth);

adminRouter.get("/admin", async (c) => {
  const chs = await db
    .select({
      channelId: channels.channelId,
      name: channels.name,
      webhookUrl: channels.webhookUrl,
    })
    .from(channels);
  const [{ messages: mcount }] = await db
    .select({ messages: sql<number>`count(*)::int` })
    .from(messages);
  const [{ deliveries }] = await db
    .select({ deliveries: sql<number>`count(*)::int` })
    .from(webhookDeliveries);
  return c.html(
    <Dashboard
      channels={chs}
      totalMessages={mcount}
      totalWebhookDeliveries={deliveries}
    />
  );
});

adminRouter.get("/admin/channels", async (c) => {
  const chs = await db.select().from(channels);
  const ids = chs.map((c) => c.id);
  const tokens = ids.length
    ? await db
        .select({
          channelId: accessTokens.channelId,
          token: accessTokens.token,
          expiresAt: accessTokens.expiresAt,
          revoked: accessTokens.revoked,
        })
        .from(accessTokens)
        .where(inArray(accessTokens.channelId, ids))
    : [];
  const now = Date.now();
  const byChannel = new Map<number, string[]>();
  for (const t of tokens) {
    if (t.revoked || t.expiresAt.getTime() < now) continue;
    const arr = byChannel.get(t.channelId) ?? [];
    arr.push(t.token);
    byChannel.set(t.channelId, arr);
  }
  return c.html(
    <Channels
      channels={chs.map((ch) => ({
        id: ch.id,
        channelId: ch.channelId,
        channelSecret: ch.channelSecret,
        name: ch.name,
        webhookUrl: ch.webhookUrl,
        webhookEnabled: ch.webhookEnabled,
        activeTokens: byChannel.get(ch.id) ?? [],
      }))}
    />
  );
});

adminRouter.post("/admin/channels", async (c) => {
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  if (!name) return c.redirect("/admin/channels");
  const channelId = Array.from({ length: 10 }, () =>
    String(Math.floor(Math.random() * 10))
  ).join("");
  await db.insert(channels).values({
    channelId,
    channelSecret: randomHex(16),
    name,
  });
  return c.redirect("/admin/channels");
});

adminRouter.delete("/admin/channels/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await db.delete(channels).where(eq(channels.id, id));
  return c.redirect("/admin/channels");
});

adminRouter.post("/admin/channels/:id/token", async (c) => {
  const id = Number(c.req.param("id"));
  await db.insert(accessTokens).values({
    channelId: id,
    token: accessTokenStr(),
    expiresAt: new Date(Date.now() + config.tokenTtlSec * 1000),
  });
  return c.redirect("/admin/channels");
});

adminRouter.put("/admin/channels/:id/webhook", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const webhookUrl = String(form.webhookUrl ?? "").trim() || null;
  const enabled = form.enabled !== undefined;
  if (webhookUrl) {
    const policy = checkWebhookUrl(webhookUrl);
    if (!policy.ok) {
      return c.text(`webhook URL rejected: ${policy.reason}`, 400);
    }
  }
  await db
    .update(channels)
    .set({ webhookUrl, webhookEnabled: enabled })
    .where(eq(channels.id, id));
  return c.redirect("/admin/channels");
});

adminRouter.get("/admin/users", async (c) => {
  const users = await db
    .select({
      id: virtualUsers.id,
      userId: virtualUsers.userId,
      displayName: virtualUsers.displayName,
      language: virtualUsers.language,
    })
    .from(virtualUsers);
  return c.html(<Users users={users} />);
});

adminRouter.post("/admin/users", async (c) => {
  const form = await c.req.parseBody();
  const displayName = String(form.displayName ?? "").trim();
  if (!displayName) return c.redirect("/admin/users");
  const language = String(form.language ?? "ja").trim() || "ja";
  await db.insert(virtualUsers).values({
    userId: "U" + randomHex(16),
    displayName,
    language,
  });
  return c.redirect("/admin/users");
});

adminRouter.delete("/admin/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await db.delete(virtualUsers).where(eq(virtualUsers.id, id));
  return c.redirect("/admin/users");
});

adminRouter.get("/admin/events", sseHandler);

adminRouter.get("/admin/conversations/:cid/:uid", async (c) => {
  const cid = Number(c.req.param("cid"));
  const uid = Number(c.req.param("uid"));
  const [ch] = await db
    .select({ name: channels.name })
    .from(channels)
    .where(eq(channels.id, cid))
    .limit(1);
  const [u] = await db
    .select({ displayName: virtualUsers.displayName })
    .from(virtualUsers)
    .where(eq(virtualUsers.id, uid))
    .limit(1);
  const msgs = await db
    .select()
    .from(messages)
    .where(and(eq(messages.channelId, cid), eq(messages.virtualUserId, uid)))
    .orderBy(messages.createdAt);
  return c.html(
    <Conversation
      channelId={cid}
      virtualUserId={uid}
      channelName={ch?.name ?? "?"}
      userName={u?.displayName ?? "?"}
      messages={msgs.map((m) => ({
        id: m.id,
        direction: m.direction as "bot_to_user" | "user_to_bot",
        type: m.type,
        payload: m.payload,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
});

adminRouter.post("/admin/conversations/:cid/:uid/send", async (c) => {
  const cid = Number(c.req.param("cid"));
  const uid = Number(c.req.param("uid"));
  const form = await c.req.parseBody();
  const text = String(form.text ?? "").trim();
  if (!text) return c.redirect(`/admin/conversations/${cid}/${uid}`);
  const [u] = await db
    .select()
    .from(virtualUsers)
    .where(eq(virtualUsers.id, uid))
    .limit(1);
  const [ch] = await db
    .select()
    .from(channels)
    .where(eq(channels.id, cid))
    .limit(1);
  if (!u || !ch) return c.redirect(`/admin/conversations/${cid}/${uid}`);
  const rt = replyToken();
  const mid = messageId();
  const [row] = await db
    .insert(messages)
    .values({
      messageId: mid,
      channelId: cid,
      virtualUserId: uid,
      direction: "user_to_bot",
      type: "text",
      payload: { type: "text", id: mid, text },
      replyToken: rt,
    })
    .returning();
  bus.emitEvent({
    type: "message.inserted",
    channelId: cid,
    virtualUserId: uid,
    id: row.id,
  });
  // Fire-and-forget webhook dispatch.
  dispatchWebhook(cid, {
    destination: ch.channelId,
    events: [
      {
        type: "message",
        mode: "active",
        timestamp: Date.now(),
        source: { type: "user", userId: u.userId },
        webhookEventId: randomHex(16),
        deliveryContext: { isRedelivery: false },
        message: { type: "text", id: mid, text, quoteToken: randomHex(16) },
        replyToken: rt,
      },
    ],
  }).catch((e) => console.error("dispatch failed:", e));
  return c.redirect(`/admin/conversations/${cid}/${uid}`);
});

adminRouter.get("/admin/webhook-log", async (c) => {
  const rows = await db
    .select({
      id: webhookDeliveries.id,
      targetUrl: webhookDeliveries.targetUrl,
      statusCode: webhookDeliveries.statusCode,
      error: webhookDeliveries.error,
      durationMs: webhookDeliveries.durationMs,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(100);
  return c.html(
    <WebhookLog
      rows={rows.map((r) => ({
        id: r.id,
        targetUrl: r.targetUrl,
        statusCode: r.statusCode,
        error: r.error,
        durationMs: r.durationMs,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
});

adminRouter.get("/admin/api-log", async (c) => {
  const rows = await db
    .select({
      id: apiLogs.id,
      method: apiLogs.method,
      path: apiLogs.path,
      responseStatus: apiLogs.responseStatus,
      durationMs: apiLogs.durationMs,
      createdAt: apiLogs.createdAt,
    })
    .from(apiLogs)
    .orderBy(desc(apiLogs.createdAt))
    .limit(200);
  return c.html(
    <ApiLog
      rows={rows.map((r) => ({
        id: r.id,
        method: r.method,
        path: r.path,
        responseStatus: r.responseStatus,
        durationMs: r.durationMs,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
});
