import { Hono } from "hono";
import { sql, eq, inArray, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels, messages, webhookDeliveries, accessTokens, virtualUsers, channelFriends, apiLogs, coupons, richMenus, richMenuImages, userRichMenuLinks } from "../db/schema.js";
import { adminAuth } from "./auth.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Channels } from "./pages/Channels.js";
import { Users } from "./pages/Users.js";
import { Conversation } from "./pages/Conversation.js";
import { WebhookLog } from "./pages/WebhookLog.js";
import { ApiLog } from "./pages/ApiLog.js";
import { Coupons } from "./pages/Coupons.js";
import { RichMenus } from "./pages/RichMenus.js";
import { accessTokenStr, randomHex, messageId, replyToken, couponId as makeCouponId, richMenuId as makeRichMenuId } from "../lib/id.js";
import { config } from "../config.js";
import { sseHandler } from "./sse.js";
import { dispatchWebhook } from "../webhook/dispatcher.js";
import { bus } from "../lib/events.js";
import { checkWebhookUrl } from "../webhook/url-policy.js";

const VALID_TIMEZONES = new Set([
  "ETC_GMT_MINUS_12", "ETC_GMT_MINUS_11", "PACIFIC_HONOLULU",
  "AMERICA_ANCHORAGE", "AMERICA_LOS_ANGELES", "AMERICA_PHOENIX",
  "AMERICA_CHICAGO", "AMERICA_NEW_YORK", "AMERICA_CARACAS",
  "AMERICA_SANTIAGO", "AMERICA_ST_JOHNS", "AMERICA_SAO_PAULO",
  "ETC_GMT_MINUS_2", "ATLANTIC_CAPE_VERDE", "EUROPE_LONDON",
  "EUROPE_PARIS", "EUROPE_ISTANBUL", "EUROPE_MOSCOW", "ASIA_TEHRAN",
  "ASIA_TBILISI", "ASIA_KABUL", "ASIA_TASHKENT", "ASIA_COLOMBO",
  "ASIA_KATHMANDU", "ASIA_ALMATY", "ASIA_RANGOON", "ASIA_BANGKOK",
  "ASIA_TAIPEI", "ASIA_TOKYO", "AUSTRALIA_DARWIN", "AUSTRALIA_SYDNEY",
  "ASIA_VLADIVOSTOK", "ETC_GMT_PLUS_12", "PACIFIC_TONGATAPU",
]);

const VALID_REWARD_TYPES = new Set([
  "cashBack", "discount", "free", "gift", "others",
]);

export const adminRouter = new Hono();
adminRouter.use("/admin", adminAuth);
adminRouter.use("/admin/*", adminAuth);

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

adminRouter.get("/admin/coupons", async (c) => {
  const rows = await db
    .select({
      couponId: coupons.couponId,
      payload: coupons.payload,
      status: coupons.status,
      channelName: channels.name,
    })
    .from(coupons)
    .innerJoin(channels, eq(coupons.channelId, channels.id))
    .orderBy(desc(coupons.createdAt));

  const channelOpts = await db
    .select({ id: channels.id, name: channels.name })
    .from(channels);

  const viewRows = rows.map((r) => {
    const p = r.payload as any;
    const reward = p.reward ?? {};
    let summary = reward.type ?? "?";
    if (reward.type === "discount" || reward.type === "cashBack") {
      const pi = reward.priceInfo ?? {};
      if (pi.type === "percentage") summary = `${reward.type} ${pi.percentage}%`;
      else if (pi.type === "fixed") summary = `${reward.type} ¥${pi.fixedAmount}`;
    }
    return {
      couponId: r.couponId,
      channelName: r.channelName,
      title: p.title ?? "",
      status: r.status,
      startTimestamp: p.startTimestamp ?? 0,
      endTimestamp: p.endTimestamp ?? 0,
      rewardSummary: summary,
    };
  });

  return c.html(<Coupons rows={viewRows} channels={channelOpts} />);
});

adminRouter.post("/admin/coupons", async (c) => {
  const form = await c.req.parseBody();
  const channelId = Number(form.channelId);
  const title = String(form.title ?? "").trim();
  const description = String(form.description ?? "").trim() || undefined;
  const imageUrl = String(form.imageUrl ?? "").trim() || undefined;
  const timezone = String(form.timezone ?? "ASIA_TOKYO");
  const rewardType = String(form.rewardType ?? "discount");
  const percentage = Number(form.percentage ?? 10);
  const startIso = String(form.startTimestampIso ?? "");
  const endIso = String(form.endTimestampIso ?? "");

  // Server-side validation mirroring the API path. Invalid input → 400 with a
  // plain-text body so the admin sees a useful message rather than an opaque 500.
  if (!Number.isInteger(channelId) || channelId <= 0) {
    return c.text("Invalid channelId", 400);
  }
  const [ch] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!ch) {
    return c.text("Channel not found", 400);
  }
  if (title.length < 1 || title.length > 60) {
    return c.text("title must be 1..60 characters", 400);
  }
  if (!VALID_TIMEZONES.has(timezone)) {
    return c.text(`Invalid timezone: ${timezone}`, 400);
  }
  if (!VALID_REWARD_TYPES.has(rewardType)) {
    return c.text(`Invalid rewardType: ${rewardType}`, 400);
  }
  if (!Number.isInteger(percentage) || percentage < 1 || percentage > 99) {
    return c.text("percentage must be an integer in [1,99]", 400);
  }

  if (!title || !startIso || !endIso) {
    return c.redirect("/admin/coupons");
  }
  const startTimestamp = Math.floor(new Date(startIso).getTime() / 1000);
  const endTimestamp = Math.floor(new Date(endIso).getTime() / 1000);
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) {
    return c.redirect("/admin/coupons");
  }
  if (startTimestamp >= endTimestamp) {
    return c.text("startTimestamp must be < endTimestamp", 400);
  }

  let reward: Record<string, unknown>;
  if (rewardType === "discount" || rewardType === "cashBack") {
    reward = {
      type: rewardType,
      priceInfo: { type: "percentage", percentage },
    };
  } else {
    reward = { type: rewardType };
  }

  const newId = makeCouponId();
  const detail: Record<string, unknown> = {
    couponId: newId,
    title,
    description,
    imageUrl,
    startTimestamp,
    endTimestamp,
    maxUseCountPerTicket: 1,
    timezone,
    visibility: "UNLISTED",
    acquisitionCondition: { type: "normal" },
    reward,
    status: "RUNNING",
    createdTimestamp: Math.floor(Date.now() / 1000),
  };
  await db.insert(coupons).values({
    couponId: newId,
    channelId,
    payload: detail,
    status: "RUNNING",
  });
  return c.redirect("/admin/coupons");
});

adminRouter.post("/admin/coupons/:couponId/close", async (c) => {
  const couponIdParam = c.req.param("couponId");
  const [row] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.couponId, couponIdParam))
    .limit(1);
  if (row && row.status !== "CLOSED") {
    await db
      .update(coupons)
      .set({
        status: "CLOSED",
        payload: { ...(row.payload as object), status: "CLOSED" },
      })
      .where(eq(coupons.id, row.id));
  }
  return c.redirect("/admin/coupons");
});

adminRouter.get("/admin/richmenus", async (c) => {
  const allChannels = await db
    .select({
      id: channels.id,
      name: channels.name,
      defaultRichMenuId: channels.defaultRichMenuId,
    })
    .from(channels);
  const channelById = new Map(allChannels.map((c) => [c.id, c]));

  const menuRows = await db.select().from(richMenus);
  const imageIds = new Set(
    (
      await db.select({ id: richMenuImages.richMenuId }).from(richMenuImages)
    ).map((r) => r.id)
  );
  const linkCounts = new Map<number, number>();
  const linkRows = await db
    .select({ internalId: userRichMenuLinks.richMenuId })
    .from(userRichMenuLinks);
  for (const r of linkRows) {
    linkCounts.set(r.internalId, (linkCounts.get(r.internalId) ?? 0) + 1);
  }

  const viewRows = menuRows.map((r) => {
    const p = r.payload as any;
    const ch = channelById.get(r.channelId);
    return {
      richMenuId: r.richMenuId,
      channelDbId: r.channelId,
      channelName: ch?.name ?? "?",
      name: String(p.name ?? ""),
      chatBarText: String(p.chatBarText ?? ""),
      size: {
        width: Number(p.size?.width ?? 0),
        height: Number(p.size?.height ?? 0),
      },
      areaCount: Array.isArray(p.areas) ? p.areas.length : 0,
      hasImage: imageIds.has(r.id),
      linkedUsers: linkCounts.get(r.id) ?? 0,
      isDefault: ch?.defaultRichMenuId === r.id,
    };
  });

  const userRows = await db
    .select({
      dbId: virtualUsers.id,
      userIdStr: virtualUsers.userId,
      displayName: virtualUsers.displayName,
      channelDbId: channelFriends.channelId,
    })
    .from(channelFriends)
    .innerJoin(virtualUsers, eq(channelFriends.userId, virtualUsers.id));

  return c.html(
    <RichMenus
      rows={viewRows}
      channels={allChannels.map((c) => ({ id: c.id, name: c.name }))}
      users={userRows}
    />
  );
});

adminRouter.post("/admin/richmenus", async (c) => {
  const form = await c.req.parseBody();
  const channelId = Number(form.channelId);
  const jsonStr = String(form.json ?? "");
  if (!Number.isInteger(channelId) || channelId <= 0) {
    return c.text("Invalid channelId", 400);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return c.text("Invalid JSON", 400);
  }
  const newId = makeRichMenuId();
  await db.insert(richMenus).values({
    richMenuId: newId,
    channelId,
    payload: { ...parsed, richMenuId: newId },
  });
  return c.redirect("/admin/richmenus");
});

adminRouter.get("/admin/richmenus/:richMenuId/content", async (c) => {
  const id = c.req.param("richMenuId");
  const rows = await db
    .select({
      internalId: richMenus.id,
      contentType: richMenuImages.contentType,
      data: richMenuImages.data,
    })
    .from(richMenus)
    .leftJoin(richMenuImages, eq(richMenus.id, richMenuImages.richMenuId))
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  const row = rows[0];
  if (!row?.data || !row.contentType) return c.notFound();
  c.header("Content-Type", row.contentType);
  return c.body(row.data as unknown as ArrayBuffer);
});

adminRouter.post("/admin/richmenus/:richMenuId/upload", async (c) => {
  const id = c.req.param("richMenuId");
  const form = await c.req.parseBody();
  const file = form.image;
  if (!(file instanceof File)) {
    return c.text("No image uploaded", 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type.toLowerCase();
  if (mime !== "image/png" && mime !== "image/jpeg") {
    return c.text("Only image/png or image/jpeg accepted", 400);
  }
  if (buf.length > 1_048_576) {
    return c.text("Image must be <= 1 MB", 400);
  }
  const [rm] = await db
    .select({ internalId: richMenus.id })
    .from(richMenus)
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  if (!rm) return c.text("Rich menu not found", 404);
  await db
    .delete(richMenuImages)
    .where(eq(richMenuImages.richMenuId, rm.internalId));
  await db.insert(richMenuImages).values({
    richMenuId: rm.internalId,
    contentType: mime,
    data: buf,
  });
  return c.redirect("/admin/richmenus");
});

adminRouter.post("/admin/richmenus/:richMenuId/set-default", async (c) => {
  const id = c.req.param("richMenuId");
  const [rm] = await db
    .select({ internalId: richMenus.id, channelDbId: richMenus.channelId })
    .from(richMenus)
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  if (!rm) return c.text("Not found", 404);
  await db
    .update(channels)
    .set({ defaultRichMenuId: rm.internalId })
    .where(eq(channels.id, rm.channelDbId));
  return c.redirect("/admin/richmenus");
});

adminRouter.post("/admin/richmenus/:richMenuId/link", async (c) => {
  const id = c.req.param("richMenuId");
  const form = await c.req.parseBody();
  const userDbId = Number(form.virtualUserDbId);
  if (!Number.isInteger(userDbId) || userDbId <= 0) {
    return c.text("Invalid user", 400);
  }
  const [rm] = await db
    .select({ internalId: richMenus.id, channelDbId: richMenus.channelId })
    .from(richMenus)
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  if (!rm) return c.text("Not found", 404);
  await db
    .delete(userRichMenuLinks)
    .where(
      and(
        eq(userRichMenuLinks.channelId, rm.channelDbId),
        eq(userRichMenuLinks.userId, userDbId)
      )
    );
  await db.insert(userRichMenuLinks).values({
    channelId: rm.channelDbId,
    userId: userDbId,
    richMenuId: rm.internalId,
  });
  return c.redirect("/admin/richmenus");
});

adminRouter.delete("/admin/richmenus/:richMenuId", async (c) => {
  const id = c.req.param("richMenuId");
  const [row] = await db
    .select({ internalId: richMenus.id })
    .from(richMenus)
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  if (row) {
    await db
      .update(channels)
      .set({ defaultRichMenuId: null })
      .where(eq(channels.defaultRichMenuId, row.internalId));
    await db.delete(richMenus).where(eq(richMenus.id, row.internalId));
  }
  return c.redirect("/admin/richmenus");
});
