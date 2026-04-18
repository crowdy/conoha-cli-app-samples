import { db } from "../db/client.js";
import { webhookDeliveries, channels } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { signBody } from "./signature.js";
import { bus } from "../lib/events.js";
import { checkWebhookUrl } from "./url-policy.js";

interface WebhookEvent {
  destination: string;
  events: Array<Record<string, unknown>>;
}

export async function dispatchWebhook(
  channelDbId: number,
  event: WebhookEvent
): Promise<void> {
  const [ch] = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelDbId))
    .limit(1);
  if (!ch || !ch.webhookUrl || !ch.webhookEnabled) {
    await db.insert(webhookDeliveries).values({
      channelId: channelDbId,
      eventPayload: event,
      signature: "",
      targetUrl: ch?.webhookUrl ?? "",
      statusCode: null,
      responseBody: null,
      error: ch?.webhookUrl ? "webhook disabled" : "webhook_url not set",
      durationMs: 0,
    });
    return;
  }
  const urlCheck = checkWebhookUrl(ch.webhookUrl);
  if (!urlCheck.ok) {
    console.error(`[dispatcher] webhook URL rejected: ${urlCheck.reason}`);
    await db.insert(webhookDeliveries).values({
      channelId: channelDbId,
      eventPayload: event,
      signature: "",
      targetUrl: ch.webhookUrl,
      statusCode: null,
      responseBody: null,
      error: `url_rejected: ${urlCheck.reason}`,
      durationMs: 0,
    });
    return;
  }

  const body = JSON.stringify(event);
  const signature = signBody(ch.channelSecret, body);
  const start = Date.now();
  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(ch.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-line-signature": signature,
        "user-agent": "LineBotWebhook/2.0",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = res.status;
    responseBody = (await res.text()).slice(0, 10_000);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const duration = Date.now() - start;
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      channelId: channelDbId,
      eventPayload: event,
      signature,
      targetUrl: ch.webhookUrl,
      statusCode,
      responseBody,
      error,
      durationMs: duration,
    })
    .returning({ id: webhookDeliveries.id });
  bus.emitEvent({
    type: "webhook.delivered",
    channelId: channelDbId,
    id: row.id,
    statusCode,
  });
}
