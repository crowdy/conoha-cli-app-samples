import { randomBytes } from "node:crypto";
import { db } from "./client.js";
import { channels, accessTokens, virtualUsers, channelFriends } from "./schema.js";
import { sql } from "drizzle-orm";

function hex(n: number): string {
  return randomBytes(n).toString("hex");
}

function numeric(n: number): string {
  // n digits numeric, first digit 1-9
  let s = String(1 + Math.floor(Math.random() * 9));
  for (let i = 1; i < n; i++) s += String(Math.floor(Math.random() * 10));
  return s;
}

export async function seedIfEmpty(): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(channels);
  if (count > 0) return;

  const channelId = numeric(10);
  const channelSecret = hex(16);
  const token = hex(24);

  const [channel] = await db
    .insert(channels)
    .values({
      channelId,
      channelSecret,
      name: "Default Channel",
      webhookUrl: null,
    })
    .returning();

  await db.insert(accessTokens).values({
    channelId: channel.id,
    token,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });

  const [user] = await db
    .insert(virtualUsers)
    .values({
      userId: "U" + hex(16),
      displayName: "テストユーザー",
    })
    .returning();

  await db.insert(channelFriends).values({
    channelId: channel.id,
    userId: user.id,
  });

  console.log("[line-api-mock] Seeded default channel:");
  console.log(`  channel_id:     ${channelId}`);
  console.log(`  channel_secret: ${channelSecret}`);
  console.log(`  access_token:   ${token}`);
  console.log(`  webhook_url:    (not set — configure in /admin)`);
  console.log("Default virtual user:");
  console.log(`  user_id:        ${user.userId}`);
  console.log(`  display_name:   ${user.displayName}`);
}
