import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { signBody } from "../webhook/signature.js";
import { checkWebhookUrl } from "../webhook/url-policy.js";

export const webhookEndpointRouter = new Hono<{ Variables: AuthVars }>();
webhookEndpointRouter.use("/v2/*", requestLog);
webhookEndpointRouter.use("/v2/*", bearerAuth());

webhookEndpointRouter.get(
  "/v2/bot/channel/webhook/endpoint",
  async (c) => {
    const channelDbId = c.get("channelDbId");
    const [ch] = await db
      .select({
        webhookUrl: channels.webhookUrl,
        webhookEnabled: channels.webhookEnabled,
      })
      .from(channels)
      .where(eq(channels.id, channelDbId))
      .limit(1);
    return c.json({
      endpoint: ch?.webhookUrl ?? "",
      active: ch?.webhookEnabled ?? false,
    });
  }
);

webhookEndpointRouter.put(
  "/v2/bot/channel/webhook/endpoint",
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { endpoint?: string }
      | null;
    if (!body || typeof body.endpoint !== "string") {
      return c.json({ message: "endpoint required" }, 400);
    }
    const policy = checkWebhookUrl(body.endpoint);
    if (!policy.ok) {
      return c.json({ message: `webhook URL rejected: ${policy.reason}` }, 400);
    }
    const channelDbId = c.get("channelDbId");
    await db
      .update(channels)
      .set({ webhookUrl: body.endpoint, webhookEnabled: true })
      .where(eq(channels.id, channelDbId));
    return c.body(null, 200);
  }
);

webhookEndpointRouter.post(
  "/v2/bot/channel/webhook/test",
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      endpoint?: string;
    };
    const channelDbId = c.get("channelDbId");
    const [ch] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelDbId))
      .limit(1);
    if (!ch) return c.json({ message: "channel missing" }, 500);
    const url = body.endpoint ?? ch.webhookUrl;
    if (!url) return c.json({ message: "endpoint not set" }, 400);
    const policy = checkWebhookUrl(url);
    if (!policy.ok) {
      return c.json({
        success: false,
        timestamp: new Date().toISOString(),
        statusCode: 0,
        reason: "url_rejected",
        detail: policy.reason,
      });
    }
    const start = Date.now();
    const payload = JSON.stringify({ destination: ch.channelId, events: [] });
    const sig = signBody(ch.channelSecret, payload);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-line-signature": sig,
        },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });
      return c.json({
        success: r.ok,
        timestamp: new Date().toISOString(),
        statusCode: r.status,
        reason: r.ok ? "OK" : `HTTP ${r.status}`,
        detail: (await r.text()).slice(0, 200),
      });
    } catch (e) {
      return c.json({
        success: false,
        timestamp: new Date().toISOString(),
        statusCode: 0,
        reason: "network",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
);
