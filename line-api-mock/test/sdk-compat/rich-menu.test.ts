import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { serve, type ServerType } from "@hono/node-server";
import { messagingApi } from "@line/bot-sdk";
import { startDb } from "../helpers/testcontainer.js";

const PNG_1x1 = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415408996360000000000500010D0A2DB40000000049454E44AE426082",
  "hex"
);

let container: StartedPostgreSqlContainer;
let server: ServerType;
let port: number;
let token: string;
let botUserId: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { oauthRouter } = await import("../../src/mock/oauth.js");
  const { richMenuRouter } = await import("../../src/mock/rich-menu.js");
  const { richMenuLinkRouter } = await import(
    "../../src/mock/rich-menu-link.js"
  );
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9600000001",
      channelSecret: randomHex(16),
      name: "RichMenu SDK Test",
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
    .values({ userId: botUserId, displayName: "SDK RM Tester" })
    .returning();
  await db
    .insert(channelFriends)
    .values({ channelId: ch.id, userId: u.id });

  const app = new Hono();
  app.route("/", oauthRouter);
  app.route("/", richMenuRouter);
  app.route("/", richMenuLinkRouter);
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

function apiClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: token,
    baseURL: `http://127.0.0.1:${port}`,
  });
}

function blobClient() {
  return new messagingApi.MessagingApiBlobClient({
    channelAccessToken: token,
    baseURL: `http://127.0.0.1:${port}`,
  });
}

describe("@line/bot-sdk rich menu against mock", () => {
  it("createRichMenu + setRichMenuImage + linkRichMenuIdToUser", async () => {
    const client = apiClient();
    const created = await client.createRichMenu({
      size: { width: 2500, height: 1686 },
      selected: false,
      name: "SDK menu",
      chatBarText: "Tap",
      areas: [
        {
          bounds: { x: 0, y: 0, width: 2500, height: 1686 },
          action: { type: "postback", data: "a=1" },
        },
      ],
    });
    expect(created.richMenuId).toMatch(/^richmenu-[0-9a-f]{32}$/);

    const blob = blobClient();
    await blob.setRichMenuImage(
      created.richMenuId,
      new Blob([PNG_1x1], { type: "image/png" })
    );

    await client.linkRichMenuIdToUser(botUserId, created.richMenuId);

    const got = await client.getRichMenuIdOfUser(botUserId);
    expect(got.richMenuId).toBe(created.richMenuId);
  });

  it("getRichMenuList returns created menus", async () => {
    const client = apiClient();
    const list = await client.getRichMenuList();
    expect(list.richmenus.length).toBeGreaterThanOrEqual(1);
  });
});
