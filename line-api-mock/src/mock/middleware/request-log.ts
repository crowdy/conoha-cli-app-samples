import type { MiddlewareHandler } from "hono";
import { db } from "../../db/client.js";
import { apiLogs } from "../../db/schema.js";
import { bus } from "../../lib/events.js";

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
        requestBody,
        responseStatus: c.res.status,
        responseBody,
        durationMs: duration,
      })
      .returning({ id: apiLogs.id });
    bus.emitEvent({ type: "api.logged", id: row.id });
  } catch (err) {
    console.error("request-log insert failed:", err);
  }
};
