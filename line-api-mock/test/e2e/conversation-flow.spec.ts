import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { messagingApi } from "@line/bot-sdk";

test("user→bot→reply round trip is visible in admin UI", async ({ page, request }) => {
  // 1. Start an echo bot on localhost.
  let channelAccessToken: string | null = null;
  let mockBaseUrl = "http://localhost:3000";
  const bot = createServer(async (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const ev = payload.events?.[0];
        if (ev?.type === "message" && ev.message?.type === "text" && channelAccessToken) {
          const client = new messagingApi.MessagingApiClient({
            channelAccessToken,
            baseURL: mockBaseUrl,
          });
          await client.replyMessage({
            replyToken: ev.replyToken,
            messages: [{ type: "text", text: `echo: ${ev.message.text}` }],
          });
        }
      } finally {
        res.statusCode = 200;
        res.end("OK");
      }
    });
  });
  await new Promise<void>((r) => bot.listen(0, r));
  const botPort = (bot.address() as AddressInfo).port;
  const botUrl = `http://host.docker.internal:${botPort}/webhook`;

  // 2. Discover the seeded channel via /admin/channels.
  await page.goto("/admin/channels");
  const channelIdText = await page
    .locator("xpath=(//div[contains(@class, \"text-xs\") and contains(@class, \"font-mono\") and contains(@class, \"text-slate-500\")])[1]")
    .innerText();
  expect(channelIdText).toMatch(/^\d{10}$/);

  // 3. Save webhook URL on the default channel.
  await page.locator('input[name="webhookUrl"]').first().fill(botUrl);
  await page.getByRole("button", { name: "Save" }).first().click();
  // Wait for HTMX to complete the PUT + redirect GET cycle.
  await page.waitForLoadState("networkidle");

  // 4. Issue a token and capture it.
  await page.getByRole("button", { name: /Issue token/ }).first().click();
  // Wait for HTMX to complete the POST + redirect GET cycle.
  await page.waitForLoadState("networkidle");
  const tokens = await page
    .locator("xpath=(//div[contains(@class,'font-mono break-all')])")
    .allInnerTexts();
  channelAccessToken = tokens.find((t) => t.length > 40) ?? null;
  expect(channelAccessToken).toBeTruthy();

  // 5. Send a message from user to bot.
  // Shortcut: seed uses PK=1 for the default channel and default user.
  await page.goto("/admin/conversations/1/1");
  await page.locator('input[name="text"]').fill("hello mock");
  await page.getByRole("button", { name: /Send as user/ }).click();

  // 6. Wait for echo reply to appear via SSE.
  await expect(page.locator("#messages")).toContainText(/echo: hello mock/, {
    timeout: 15_000,
  });

  bot.close();
});
