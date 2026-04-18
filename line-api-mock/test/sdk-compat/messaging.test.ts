import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { serve, type ServerType } from "@hono/node-server";
import { messagingApi } from "@line/bot-sdk";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let server: ServerType;
let port: number;
let token: string;
let botUserId: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { oauthRouter } = await import("../../src/mock/oauth.js");
  const { messageRouter } = await import("../../src/mock/message.js");
  const { profileRouter } = await import("../../src/mock/profile.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9900000001",
      channelSecret: randomHex(16),
      name: "SDK Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });
  botUserId = "U" + randomHex(16);
  const [u] = await db
    .insert(virtualUsers)
    .values({ userId: botUserId, displayName: "SDK Tester", language: "ja" })
    .returning();
  await db.insert(channelFriends).values({ channelId: ch.id, userId: u.id });

  const app = new Hono();
  app.route("/", oauthRouter);
  app.route("/", messageRouter);
  app.route("/", profileRouter);
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

describe("@line/bot-sdk MessagingApiClient against mock", () => {
  it("pushMessage succeeds", async () => {
    const client = sdkClient();
    const res = await client.pushMessage({
      to: botUserId,
      messages: [{ type: "text", text: "hi from sdk" }],
    });
    expect(Array.isArray(res.sentMessages)).toBe(true);
    expect(res.sentMessages!.length).toBe(1);
  });

  it("multicast succeeds", async () => {
    const client = sdkClient();
    const res = await client.multicast({
      to: [botUserId],
      messages: [{ type: "text", text: "multi" }],
    });
    expect(res).toBeDefined();
  });

  it("broadcast succeeds", async () => {
    const client = sdkClient();
    await client.broadcast({
      messages: [{ type: "text", text: "broadcast" }],
    });
  });

  it("getProfile returns a known user", async () => {
    const client = sdkClient();
    const p = await client.getProfile(botUserId);
    expect(p.userId).toBe(botUserId);
    expect(p.displayName).toBe("SDK Tester");
  });
});
