import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import { startDb, type DbHandle } from "../../helpers/testcontainer.js";

// Common bootstrap for SDK-compat suites.
//
// Two modes:
//
// - `authMode: "db"` (default): startDb() (shared via globalSetup when running
//   under vitest.sdk.config.ts; per-suite container for ad-hoc runs), seed a
//   real channel + access token (+ optional friend user), mount the caller's
//   routers, start a Hono node-server. Suites that exercise persisted state
//   (coupon, messaging, rich-menu) need this mode.
//
// - `authMode: "in-memory"`: skip the DB entirely. Generate an in-memory
//   channel + token, install a Map-backed `setDefaultTokenLookup` so
//   bearerAuth resolves the token without reading `accessTokens`, mount
//   routers, start the server. Suites whose endpoints return canned/computed
//   responses (progress) and only need auth to pass can use this mode and
//   skip the ~3-5 s container startup.
//
// `src/db/client.ts` reads `DATABASE_URL` at import time via `src/config.ts`,
// so all `src/*` imports remain dynamic — they only execute after the
// caller's chosen mode has set things up.

export interface SdkCompatHarness {
  port: number;
  token: string;
  channelDbId: number;
  /** Present only when `seedFriend` was true. Ignored in in-memory mode. */
  botUserId?: string;
  stop: () => Promise<void>;
}

export type SdkCompatAuthMode = "db" | "in-memory";

export interface StartSdkCompatServerOptions {
  channelId: string;
  channelName: string;
  /**
   * Caller mounts whatever routers it needs. Keeping this as a callback
   * (rather than a `Router[]`) lets the call site read `app.route("/", ...)`
   * top-to-bottom in source order — handy when ordering matters.
   */
  mountRouters: (app: Hono) => Promise<void> | void;
  /** @default "db" */
  authMode?: SdkCompatAuthMode;
  /** Ignored when `authMode === "in-memory"`. */
  seedFriend?: boolean;
  friendDisplayName?: string;
  friendLanguage?: string;
}

export async function startSdkCompatServer(
  opts: StartSdkCompatServerOptions
): Promise<SdkCompatHarness> {
  const { Hono } = await import("hono");
  const { randomHex, accessTokenStr } = await import("../../../src/lib/id.js");

  const token = accessTokenStr();

  if (opts.authMode === "in-memory") {
    return startInMemoryHarness({
      token,
      channelId: opts.channelId,
      mountRouters: opts.mountRouters,
      Hono,
    });
  }

  return startDbHarness({
    token,
    opts,
    Hono,
    randomHex,
  });
}

async function startDbHarness(args: {
  token: string;
  opts: StartSdkCompatServerOptions;
  Hono: typeof import("hono").Hono;
  randomHex: typeof import("../../../src/lib/id.js")["randomHex"];
}): Promise<SdkCompatHarness> {
  const { token, opts, Hono, randomHex } = args;
  const container: DbHandle = await startDb();

  const { db } = await import("../../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../../src/db/schema.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: opts.channelId,
      channelSecret: randomHex(16),
      name: opts.channelName,
    })
    .returning();
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

  const { server, port } = await mountAndServe(Hono, opts.mountRouters);
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

async function startInMemoryHarness(args: {
  token: string;
  channelId: string;
  mountRouters: StartSdkCompatServerOptions["mountRouters"];
  Hono: typeof import("hono").Hono;
}): Promise<SdkCompatHarness> {
  const { token, channelId, mountRouters, Hono } = args;
  const channelDbId = 1;
  const channelSecret = "in-memory-secret";

  // Install the in-memory lookup BEFORE mounting routers so the very first
  // request has the override in place. (The factory reads the lookup at
  // request time, so install order isn't strictly load-bearing — but doing
  // it up front keeps the contract obvious.)
  const { setDefaultTokenLookup } = await import(
    "../../../src/mock/middleware/auth.js"
  );
  setDefaultTokenLookup(async (t) => {
    if (t !== token) return null;
    return {
      channelDbId,
      channelId,
      channelSecret,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      revoked: false,
    };
  });

  const { server, port } = await mountAndServe(Hono, mountRouters);
  return {
    port,
    token,
    channelDbId,
    stop: async () => {
      server?.close();
      setDefaultTokenLookup(undefined);
    },
  };
}

async function mountAndServe(
  Hono: typeof import("hono").Hono,
  mountRouters: StartSdkCompatServerOptions["mountRouters"]
): Promise<{ server: ServerType; port: number }> {
  const app = new Hono();
  await mountRouters(app);

  let server!: ServerType;
  let port = 0;
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });
  return { server, port };
}
