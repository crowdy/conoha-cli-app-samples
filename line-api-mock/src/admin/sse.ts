import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { bus, type AppEvent } from "../lib/events.js";
import { db } from "../db/client.js";
import { messages } from "../db/schema.js";
import { eq } from "drizzle-orm";

export interface MessageRow {
  id: number;
  direction: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export function buildMessageHtml(m: MessageRow): string {
  return `<div class="${
    m.direction === "user_to_bot"
      ? "self-end bg-green-100"
      : "self-start bg-slate-200"
  } px-3 py-2 rounded-lg max-w-sm"><div class="text-xs text-slate-500 mb-1">${escape(
    m.direction
  )} · ${escape(m.type)}</div><div class="font-mono text-xs whitespace-pre-wrap">${escape(
    JSON.stringify(m.payload)
  )}</div></div>`;
}

// AUTH NOTE — coupling to Basic Auth.
// This handler is mounted under `/admin/*` which `adminAuth` (Basic Auth)
// gates. Browsers automatically resend the Basic Auth header on every
// EventSource request to a same-origin URL, so the SSE stream gets
// authenticated implicitly. If the admin UI is ever migrated to a cookie
// session (e.g. signed session id + CSRF token, see issue #21 I4), this
// path will break: EventSource does not send credentials cross-origin
// without `withCredentials`, and even same-origin it sends cookies but
// not custom auth headers. At that point the SSE auth path must be
// redesigned — likely a one-shot signed query token issued by the page
// load, validated here before subscribing to `bus`.
export async function sseHandler(c: Context) {
  const scope = c.req.query("scope") ?? "all";
  const channel = Number(c.req.query("channel") ?? 0);
  const user = Number(c.req.query("user") ?? 0);

  return streamSSE(c, async (stream) => {
    const listener = async (ev: AppEvent) => {
      if (scope === "conversation" && ev.type === "message.inserted") {
        if (ev.channelId !== channel || ev.virtualUserId !== user) return;
        const [m] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, ev.id))
          .limit(1);
        if (!m) return;
        const html = buildMessageHtml(m);
        await stream.writeSSE({ event: "message", data: html });
      } else if (scope === "webhook") {
        if (ev.type === "webhook.delivered") {
          await stream.writeSSE({
            event: "message",
            data: `<tr><td class="p-2">${escape(String(ev.id))}</td><td class="p-2">${escape(
              String(ev.statusCode ?? "err")
            )}</td></tr>`,
          });
        }
      }
    };
    bus.on("event", listener);
    stream.onAbort(() => { bus.off("event", listener); });
    // Keep-alive ping every 20s.
    while (true) {
      await new Promise((r) => setTimeout(r, 20_000));
      await stream.writeSSE({ event: "ping", data: "" });
    }
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
