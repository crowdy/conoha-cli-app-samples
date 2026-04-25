import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messagingApi } from "@line/bot-sdk";
import {
  startSdkCompatServer,
  type SdkCompatHarness,
} from "./helpers/harness.js";

// Pins the SDK Date/string mismatch documented in issue #34 (M2).
//
// @line/bot-sdk declares NarrowcastProgressResponse.acceptedTime and
// RichMenuBatchProgressResponse.acceptedTime as `Date`, but the generated
// deserializer (`text ? JSON.parse(text) : null`) does not coerce strings
// to Date objects. The real LINE API and our mock both return ISO 8601
// strings on the wire. If SDK codegen ever starts coercing, these
// assertions will flip to Date and the pin can be revisited.

let harness: SdkCompatHarness;

beforeAll(async () => {
  harness = await startSdkCompatServer({
    channelId: "9900000099",
    channelName: "SDK Progress Test",
    mountRouters: async (app) => {
      const { oauthRouter } = await import("../../src/mock/oauth.js");
      const { messageRouter } = await import("../../src/mock/message.js");
      const { richMenuBatchRouter } = await import(
        "../../src/mock/rich-menu-batch.js"
      );
      app.route("/", oauthRouter);
      app.route("/", messageRouter);
      app.route("/", richMenuBatchRouter);
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
