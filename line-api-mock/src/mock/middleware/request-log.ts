import type { MiddlewareHandler } from "hono";
import { db } from "../../db/client.js";
import { apiLogs } from "../../db/schema.js";
import { bus } from "../../lib/events.js";

// Cap each persisted body at ~4 KB of JSON so an api_logs row can never
// individually balloon (e.g. a large rich-menu image base64, or a 1 MB
// narrowcast payload). The cap is on the serialized size, not the row's
// jsonb storage cost — close enough for an upper bound, and trivial to reason
// about when staring at the request log UI.
const BODY_BYTES_CAP = 4096;
const BODY_PREVIEW_BYTES = 1024;

export interface TruncatedBody {
  _truncated: true;
  _originalBytes: number;
  _previewBytes: number;
  _preview: string;
}

export function truncateBodyForLog(body: unknown): unknown | TruncatedBody {
  if (body === null || body === undefined) return body;
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    // Circular or otherwise non-serializable → drop it rather than crash the
    // request-log path. Should not happen for HTTP bodies.
    return null;
  }
  if (serialized.length <= BODY_BYTES_CAP) return body;
  return {
    _truncated: true,
    _originalBytes: serialized.length,
    _previewBytes: Math.min(BODY_PREVIEW_BYTES, serialized.length),
    _preview: serialized.slice(0, BODY_PREVIEW_BYTES),
  } satisfies TruncatedBody;
}

export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  let requestBody: unknown = null;

  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      requestBody = await c.req.json();
    } catch {
      requestBody = null;
    }
  }

  await next();

  const duration = Date.now() - start;
  const channelId =
    (c.get("channelDbId" as never) as number | undefined) ?? null;

  let responseBody: unknown = null;
  const resCt = c.res.headers.get("content-type") ?? "";
  if (resCt.includes("application/json")) {
    try {
      responseBody = await c.res.clone().json();
    } catch {
      responseBody = null;
    }
  }

  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => {
    // Mask Authorization header to avoid persisting raw tokens.
    headers[k] = k.toLowerCase() === "authorization" ? "***" : v;
  });

  try {
    const [row] = await db
      .insert(apiLogs)
      .values({
        channelId,
        method: c.req.method,
        path: c.req.path,
        requestHeaders: headers,
        requestBody: truncateBodyForLog(requestBody),
        responseStatus: c.res.status,
        responseBody: truncateBodyForLog(responseBody),
        durationMs: duration,
      })
      .returning({ id: apiLogs.id });
    bus.emitEvent({ type: "api.logged", id: row.id });
  } catch (err) {
    console.error("request-log insert failed:", err);
  }
};
