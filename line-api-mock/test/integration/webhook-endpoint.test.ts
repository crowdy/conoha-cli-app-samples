import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;
let botServer: ReturnType<typeof createServer>;
let botUrl: string;
let received: { signature: string; body: string } | null = null;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { webhookEndpointRouter } = await import(
    "../../src/mock/webhook-endpoint.js"
  );
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9000000005",
      channelSecret: randomHex(16),
      name: "Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  botServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received = {
        signature: req.headers["x-line-signature"] as string,
        body,
      };
      res.statusCode = 200;
      res.end("OK");
    });
  });
  await new Promise<void>((resolve) => botServer.listen(0, resolve));
  const port = (botServer.address() as AddressInfo).port;
  botUrl = `http://127.0.0.1:${port}/webhook`;

  app = new Hono();
  app.route("/", webhookEndpointRouter);
}, 60_000);

afterAll(async () => {
  botServer.close();
  await container.stop();
});

describe("webhook endpoint config", () => {
  it("PUT sets endpoint; GET returns it", async () => {
    await app.request("/v2/bot/channel/webhook/endpoint", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint: botUrl }),
    });
    const res = await app.request("/v2/bot/channel/webhook/endpoint", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await res.json()).toEqual({ endpoint: botUrl, active: true });
  });

  it("POST /test posts signed payload to the configured endpoint", async () => {
    const res = await app.request("/v2/bot/channel/webhook/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: "{}",
    });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(received?.signature).toBeTruthy();
    expect(received?.body).toContain("\"events\":[]");
  });
});
