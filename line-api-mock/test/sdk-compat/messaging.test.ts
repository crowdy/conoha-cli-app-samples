import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messagingApi } from "@line/bot-sdk";
import {
  startSdkCompatServer,
  type SdkCompatHarness,
} from "./helpers/harness.js";

let harness: SdkCompatHarness;

beforeAll(async () => {
  harness = await startSdkCompatServer({
    channelId: "9900000001",
    channelName: "SDK Test",
    seedFriend: true,
    friendDisplayName: "SDK Tester",
    friendLanguage: "ja",
    mountRouters: async (app) => {
      const { oauthRouter } = await import("../../src/mock/oauth.js");
      const { messageRouter } = await import("../../src/mock/message.js");
      const { profileRouter } = await import("../../src/mock/profile.js");
      app.route("/", oauthRouter);
      app.route("/", messageRouter);
      app.route("/", profileRouter);
    },
  });
}, 90_000);

afterAll(async () => {
  await harness.stop();
});

function sdkClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: harness.token,
    baseURL: `http://127.0.0.1:${harness.port}`,
  });
}

describe("@line/bot-sdk MessagingApiClient against mock", () => {
  it("pushMessage succeeds", async () => {
    const client = sdkClient();
    const res = await client.pushMessage({
      to: harness.botUserId!,
      messages: [{ type: "text", text: "hi from sdk" }],
    });
    expect(Array.isArray(res.sentMessages)).toBe(true);
    expect(res.sentMessages!.length).toBe(1);
  });

  it("multicast succeeds", async () => {
    const client = sdkClient();
    const res = await client.multicast({
      to: [harness.botUserId!],
      messages: [{ type: "text", text: "multi" }],
    });
    expect(res).toBeDefined();
  });

  it("broadcast succeeds and reaches the seeded friend user", async () => {
    const client = sdkClient();
    // Stamp the wall clock just before the call so the row-shape assertion
    // below scopes to *this* broadcast, not the bot_to_user rows that the
    // earlier pushMessage / multicast tests already left behind.
    const before = new Date();
    const res = await client.broadcast({
      messages: [{ type: "text", text: "broadcast" }],
    });
    // LINE's broadcast returns an empty `{}` body; the SDK surfaces it as an
    // empty object. Pin the shape so a future regression (e.g. returning the
    // message array by mistake) fails here.
    expect(res).toEqual({});

    // Verify the broadcast actually fanned out to the seeded friend by
    // checking that a `bot_to_user` "broadcast" text row landed in `messages`
    // for the channel/user pair within this test's window.
    const { db } = await import("../../src/db/client.js");
    const { messages: messagesTable, virtualUsers: vu } = await import(
      "../../src/db/schema.js"
    );
    const { eq, and, gt } = await import("drizzle-orm");
    const [user] = await db
      .select({ id: vu.id })
      .from(vu)
      .where(eq(vu.userId, harness.botUserId!))
      .limit(1);
    const rows = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.channelId, harness.channelDbId),
          eq(messagesTable.virtualUserId, user.id),
          eq(messagesTable.direction, "bot_to_user"),
          gt(messagesTable.createdAt, before)
        )
      );
    const broadcastRow = rows.find(
      (r) =>
        r.type === "text" &&
        (r.payload as { text?: string })?.text === "broadcast"
    );
    expect(broadcastRow).toBeDefined();
  });

  it("getProfile returns a known user", async () => {
    const client = sdkClient();
    const p = await client.getProfile(harness.botUserId!);
    expect(p.userId).toBe(harness.botUserId!);
    expect(p.displayName).toBe("SDK Tester");
  });
});
