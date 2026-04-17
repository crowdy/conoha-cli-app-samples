import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels, messages, webhookDeliveries } from "../db/schema.js";
import { adminAuth } from "./auth.js";
import { Dashboard } from "./pages/Dashboard.js";

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
