import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import { startDb, type DbHandle } from "../../helpers/testcontainer.js";

// Common bootstrap for SDK-compat suites: spin up the DB (shared via
// globalSetup when running under vitest.sdk.config.ts; per-suite container
// for ad-hoc `vitest run <file>`), seed a channel + access token + optional
// friend user, mount the caller's routers on a fresh Hono app, and start a
// Hono node-server on an ephemeral port.
//
// `src/db/client.ts` reads `DATABASE_URL` at import time via `src/config.ts`,
// so all `src/*` imports are kept dynamic (executed after `startDb()` has
// populated `process.env.DATABASE_URL` in the fallback path).

export interface SdkCompatHarness {
  port: number;
  token: string;
  channelDbId: number;
  /** Present only when `seedFriend` was true. */
  botUserId?: string;
  stop: () => Promise<void>;
}

export interface StartSdkCompatServerOptions {
  channelId: string;
  channelName: string;
  /**
   * Caller mounts whatever routers it needs. Keeping this as a callback
   * (rather than a `Router[]`) lets the call site read `app.route("/", ...)`
   * top-to-bottom in source order — handy when ordering matters.
   */
  mountRouters: (app: Hono) => Promise<void> | void;
  seedFriend?: boolean;
  friendDisplayName?: string;
  friendLanguage?: string;
}

export async function startSdkCompatServer(
  opts: StartSdkCompatServerOptions
): Promise<SdkCompatHarness> {
  const container: DbHandle = await startDb();

  const { Hono } = await import("hono");
  const { db } = await import("../../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: opts.channelId,
      channelSecret: randomHex(16),
      name: opts.channelName,
    })
    .returning();
  const token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  let botUserId: string | undefined;
  if (opts.seedFriend) {
    botUserId = "U" + randomHex(16);
    const [u] = await db
      .insert(virtualUsers)
      .values({
        userId: botUserId,
        displayName: opts.friendDisplayName ?? "SDK Tester",
        ...(opts.friendLanguage ? { language: opts.friendLanguage } : {}),
      })
      .returning();
    await db
      .insert(channelFriends)
      .values({ channelId: ch.id, userId: u.id });
  }

  const app = new Hono();
  await opts.mountRouters(app);

  let server!: ServerType;
  let port = 0;
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });

  return {
    port,
    token,
    channelDbId: ch.id,
    botUserId,
    stop: async () => {
      server?.close();
      await container.stop();
    },
  };
}
