import type { MiddlewareHandler } from "hono";
import { config } from "../config.js";

export const adminAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) {
    c.header("WWW-Authenticate", 'Basic realm="line-api-mock admin"');
    return c.text("Unauthorized", 401);
  }
  const raw = Buffer.from(m[1], "base64").toString("utf8");
  const sep = raw.indexOf(":");
  const user = raw.slice(0, sep);
  const pass = raw.slice(sep + 1);
  if (user === config.adminUser && pass === config.adminPassword) {
    return next();
  }
  c.header("WWW-Authenticate", 'Basic realm="line-api-mock admin"');
  return c.text("Unauthorized", 401);
};
