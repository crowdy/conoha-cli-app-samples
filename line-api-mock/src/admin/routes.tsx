import { Hono } from "hono";
import { sql, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels, messages, webhookDeliveries, accessTokens, virtualUsers } from "../db/schema.js";
import { adminAuth } from "./auth.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Channels } from "./pages/Channels.js";
import { Users } from "./pages/Users.js";
import { accessTokenStr, randomHex } from "../lib/id.js";
import { config } from "../config.js";

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
