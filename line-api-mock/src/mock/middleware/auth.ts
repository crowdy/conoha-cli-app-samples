import type { MiddlewareHandler } from "hono";
import { errors } from "../../lib/errors.js";

export type AuthVars = {
  channelDbId: number;
  channelId: string;
  channelSecret: string;
};

export interface ChannelLookupResult {
  channelDbId: number;
  channelId: string;
  channelSecret: string;
  expiresAt: Date;
  revoked: boolean;
}

export type TokenLookup = (
  token: string
) => Promise<ChannelLookupResult | null>;

// Lazy-imports `db` so that tests using an injected lookup never trigger a
// `postgres()` pool construction or schema import. Production behavior is
// unchanged: the first authenticated request opens the pool exactly once.
const defaultDbTokenLookup: TokenLookup = async (token) => {
  const [{ db }, { accessTokens, channels }, { and, eq }] = await Promise.all([
    import("../../db/client.js"),
    import("../../db/schema.js"),
    import("drizzle-orm"),
  ]);
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
  return rows[0] ?? null;
};

let currentDefaultLookup: TokenLookup = defaultDbTokenLookup;

// Test-only seam. Production never calls this; SDK-compat tests in
// "in-memory" auth mode swap in a Map-backed lookup so the suite can run
// without a Postgres container. Pass `undefined` to restore the default.
export function setDefaultTokenLookup(fn: TokenLookup | undefined): void {
  currentDefaultLookup = fn ?? defaultDbTokenLookup;
}

export interface BearerAuthOptions {
  /** Overrides the (currently swappable) default lookup for this middleware
   * instance only. Useful for routers that want a non-default auth source
   * without affecting global state. */
  tokenLookup?: TokenLookup;
}

export function bearerAuth(
  opts?: BearerAuthOptions
): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) return errors.missingAuth(c);
    const token = m[1].trim();

    const lookup = opts?.tokenLookup ?? currentDefaultLookup;
    const row = await lookup(token);

    if (!row || row.revoked || row.expiresAt.getTime() < Date.now()) {
      return errors.unauthorized(c);
    }

    c.set("channelDbId", row.channelDbId);
    c.set("channelId", row.channelId);
    c.set("channelSecret", row.channelSecret);

    await next();
  };
}
