import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { accessTokens, channels } from "../db/schema.js";
import { accessTokenStr, channelAccessTokenKid } from "../lib/id.js";
import { errors } from "../lib/errors.js";

export const oauthV3Router = new Hono();

/**
 * Extract the `iss` (issuer) claim from a JWT without verifying the signature.
 * Returns empty string if the JWT is malformed or has no `iss`.
 */
function extractIssFromJWT(jwt: string): string {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return "";
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    return String(payload.iss ?? "");
  } catch {
    return "";
  }
}

/**
 * POST /oauth2/v2.1/token  — stateless flow. We accept any client_assertion
 * (JWT signature not verified) and issue a token bound to the channel matched
 * by client_id. The client_id is resolved from:
 *   1. form field `client_id` (Node.js SDK sends this)
 *   2. JWT `iss` claim in `client_assertion` (Go SDK sends this)
 */
oauthV3Router.post("/oauth2/v2.1/token", async (c) => {
  const form = await c.req.parseBody();
  if (form.grant_type !== "client_credentials") {
    return errors.badRequest(c, "Invalid grant_type");
  }
  const assertion = String(form.client_assertion ?? "");
  if (!assertion) {
    return errors.badRequest(c, "client_assertion is required");
  }
  const clientId = String(form.client_id ?? "") || extractIssFromJWT(assertion);
  if (!clientId) {
    return errors.badRequest(c, "client_id is required (form field or JWT iss claim)");
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
 * GET /oauth2/v2.1/tokens/kid?client_id=...&client_assertion=...
 * client_id is resolved from:
 *   1. query param `client_id`
 *   2. JWT `iss` claim in `client_assertion` query param
 */
oauthV3Router.get("/oauth2/v2.1/tokens/kid", async (c) => {
  const assertion = c.req.query("client_assertion") ?? "";
  const clientId = c.req.query("client_id") ?? extractIssFromJWT(assertion);
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
