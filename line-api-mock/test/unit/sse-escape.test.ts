import { describe, expect, it } from "vitest";
import { buildMessageHtml } from "../../src/admin/sse.js";

describe("buildMessageHtml", () => {
  it("escapes malicious type field", () => {
    const html = buildMessageHtml({
      id: 1,
      direction: "user_to_bot",
      type: "<img src=x onerror=alert(1)>",
      payload: { type: "text", text: "hi" },
      createdAt: new Date(),
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes malicious direction field", () => {
    const html = buildMessageHtml({
      id: 2,
      direction: "<script>alert(1)</script>",
      type: "text",
      payload: {},
      createdAt: new Date(),
    });
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script");
  });
});
