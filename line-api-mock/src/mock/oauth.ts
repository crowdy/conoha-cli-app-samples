import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { accessTokens, channels } from "../db/schema.js";
import { config } from "../config.js";
import { accessTokenStr } from "../lib/id.js";
import { errors } from "../lib/errors.js";

export const oauthRouter = new Hono();

/**
 * POST /v2/oauth/accessToken
 * form: grant_type=client_credentials&client_id=<channelId>&client_secret=<secret>
 */
oauthRouter.post("/v2/oauth/accessToken", async (c) => {
  const form = await c.req.parseBody();
  const grantType = String(form.grant_type ?? "");
  const clientId = String(form.client_id ?? "");
  const clientSecret = String(form.client_secret ?? "");

  if (grantType !== "client_credentials") {
    return errors.badRequest(c, "Invalid grant_type");
  }

  const channelRows = await db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.channelId, clientId),
        eq(channels.channelSecret, clientSecret)
      )
    )
    .limit(1);

  if (channelRows.length === 0) {
    return c.json({ error: "invalid_client" }, 400);
  }

  const token = accessTokenStr();
  const expiresAt = new Date(Date.now() + config.tokenTtlSec * 1000);
  await db.insert(accessTokens).values({
    channelId: channelRows[0].id,
    token,
    expiresAt,
  });

  return c.json({
    access_token: token,
    expires_in: config.tokenTtlSec,
    token_type: "Bearer",
  });
});

/**
 * POST /v2/oauth/verify — form: access_token=...
 */
oauthRouter.post("/v2/oauth/verify", async (c) => {
  const form = await c.req.parseBody();
  const token = String(form.access_token ?? "");

  const rows = await db
    .select({
      channelId: channels.channelId,
      expiresAt: accessTokens.expiresAt,
      revoked: accessTokens.revoked,
    })
    .from(accessTokens)
    .innerJoin(channels, eq(accessTokens.channelId, channels.id))
    .where(eq(accessTokens.token, token))
    .limit(1);

  const row = rows[0];
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now()) {
    return errors.badRequest(c, "invalid_access_token");
  }

  const expiresIn = Math.max(
    0,
    Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)
  );
  return c.json({
    client_id: row.channelId,
    expires_in: expiresIn,
    scope: "",
  });
});

/**
 * POST /v2/oauth/revoke — form: access_token=...
 */
oauthRouter.post("/v2/oauth/revoke", async (c) => {
  const form = await c.req.parseBody();
  const token = String(form.access_token ?? "");
  await db
    .update(accessTokens)
    .set({ revoked: true })
    .where(eq(accessTokens.token, token));
  return c.body(null, 200);
});
