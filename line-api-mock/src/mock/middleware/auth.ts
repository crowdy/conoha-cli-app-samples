import type { MiddlewareHandler } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { accessTokens, channels } from "../../db/schema.js";
import { errors } from "../../lib/errors.js";

export type AuthVars = {
  channelDbId: number;
  channelId: string;
  channelSecret: string;
};

export const bearerAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (
  c,
  next
) => {
  const header = c.req.header("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return errors.missingAuth(c);
  const token = m[1].trim();

  const rows = await db
    .select({
      channelDbId: channels.id,
      channelId: channels.channelId,
      channelSecret: channels.channelSecret,
      expiresAt: accessTokens.expiresAt,
      revoked: accessTokens.revoked,
    })
    .from(accessTokens)
    .innerJoin(channels, eq(accessTokens.channelId, channels.id))
    .where(and(eq(accessTokens.token, token)))
    .limit(1);

  const row = rows[0];
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now()) {
    return errors.unauthorized(c);
  }

  c.set("channelDbId", row.channelDbId);
  c.set("channelId", row.channelId);
  c.set("channelSecret", row.channelSecret);

  await next();
};
