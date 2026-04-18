import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { accessTokens, channels } from "../db/schema.js";
import { accessTokenStr, channelAccessTokenKid } from "../lib/id.js";
import { errors } from "../lib/errors.js";

export const oauthV3Router = new Hono();

/**
 * POST /oauth2/v2.1/token  — stateless flow. We accept any client_assertion
 * (JWT signature not verified) and issue a token bound to the channel matched
 * by client_id (form field).
 */
oauthV3Router.post("/oauth2/v2.1/token", async (c) => {
  const form = await c.req.parseBody();
  if (form.grant_type !== "client_credentials") {
    return errors.badRequest(c, "Invalid grant_type");
  }
  const clientId = String(form.client_id ?? "");
  const assertion = String(form.client_assertion ?? "");
  if (!clientId || !assertion) {
    return errors.badRequest(c, "client_id and client_assertion required");
  }

  const channelRows = await db
    .select()
    .from(channels)
    .where(eq(channels.channelId, clientId))
    .limit(1);
  if (channelRows.length === 0) {
    return c.json({ error: "invalid_client" }, 400);
  }

  const token = accessTokenStr();
  const kid = channelAccessTokenKid();
  const ttl = 60 * 60 * 24 * 30; // 30 days
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await db.insert(accessTokens).values({
    channelId: channelRows[0].id,
    token,
    kid,
    expiresAt,
  });

  return c.json({
    access_token: token,
    expires_in: ttl,
    token_type: "Bearer",
    key_id: kid,
  });
});

/**
 * GET /oauth2/v2.1/tokens/kid?client_id=...
 */
oauthV3Router.get("/oauth2/v2.1/tokens/kid", async (c) => {
  const clientId = c.req.query("client_id") ?? "";
  const rows = await db
    .select({ kid: accessTokens.kid, revoked: accessTokens.revoked })
    .from(accessTokens)
    .innerJoin(channels, eq(accessTokens.channelId, channels.id))
    .where(and(eq(channels.channelId, clientId)));
  const kids = rows
    .filter((r) => !r.revoked && r.kid)
    .map((r) => r.kid as string);
  return c.json({ kids });
});

/**
 * POST /oauth2/v2.1/revoke
 */
oauthV3Router.post("/oauth2/v2.1/revoke", async (c) => {
  const form = await c.req.parseBody();
  const token = String(form.access_token ?? "");
  await db
    .update(accessTokens)
    .set({ revoked: true })
    .where(eq(accessTokens.token, token));
  return c.body(null, 200);
});
