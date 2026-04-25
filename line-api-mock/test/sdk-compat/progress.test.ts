import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { messagingApi } from "@line/bot-sdk";
import { startDb, type DbHandle } from "../helpers/testcontainer.js";

// Pins the SDK Date/string mismatch documented in issue #34 (M2).
//
// @line/bot-sdk declares NarrowcastProgressResponse.acceptedTime and
// RichMenuBatchProgressResponse.acceptedTime as `Date`, but the generated
// deserializer (`text ? JSON.parse(text) : null`) does not coerce strings
// to Date objects. The real LINE API and our mock both return ISO 8601
// strings on the wire. If SDK codegen ever starts coercing, these
// assertions will flip to Date and the pin can be revisited.

let container: DbHandle;
let server: ServerType;
let port: number;
let token: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { oauthRouter } = await import("../../src/mock/oauth.js");
  const { messageRouter } = await import("../../src/mock/message.js");
  const { richMenuBatchRouter } = await import(
    "../../src/mock/rich-menu-batch.js"
  );
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9900000099",
      channelSecret: randomHex(16),
      name: "SDK Progress Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  const app = new Hono();
  app.route("/", oauthRouter);
  app.route("/", messageRouter);
  app.route("/", richMenuBatchRouter);
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });
}, 90_000);

afterAll(async () => {
  server?.close();
  await container.stop();
});

function sdkClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: token,
    baseURL: `http://127.0.0.1:${port}`,
  });
}

describe("progress endpoints: SDK type declares Date, wire is string", () => {
  it("getNarrowcastProgress returns acceptedTime/completedTime as strings at runtime", async () => {
    const client = sdkClient();
    const res = await client.getNarrowcastProgress("abc");
    expect(res.phase).toBe("succeeded");
    expect(typeof res.acceptedTime).toBe("string");
    expect(typeof res.completedTime).toBe("string");
  });

  it("getRichMenuBatchProgress returns acceptedTime/completedTime as strings at runtime", async () => {
    const client = sdkClient();
    const res = await client.getRichMenuBatchProgress("abc");
    expect(res.phase).toBe("succeeded");
    expect(typeof res.acceptedTime).toBe("string");
    expect(typeof res.completedTime).toBe("string");
  });
});
