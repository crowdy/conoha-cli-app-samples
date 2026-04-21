import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { notImplementedRouter } from "../../src/mock/not-implemented.js";

const app = new Hono();
app.route("/", notImplementedRouter);

describe("501 catch-all", () => {
  it("returns 501 for insight endpoint", async () => {
    const res = await app.request("/v2/bot/insight/message/delivery");
    expect(res.status).toBe(501);
  });
});
