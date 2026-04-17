import type { MiddlewareHandler } from "hono";
import { config } from "../config.js";

export const adminAuth: MiddlewareHandler = async (c, next) => {
  if (!config.adminUser && !config.adminPassword) {
    return next();
  }
  const header = c.req.header("authorization") ?? "";
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) {
    c.header("WWW-Authenticate", 'Basic realm="line-api-mock admin"');
    return c.text("Unauthorized", 401);
  }
  const [user, pass] = Buffer.from(m[1], "base64").toString("utf8").split(":");
  if (user === config.adminUser && pass === config.adminPassword) {
    return next();
  }
  c.header("WWW-Authenticate", 'Basic realm="line-api-mock admin"');
  return c.text("Unauthorized", 401);
};
