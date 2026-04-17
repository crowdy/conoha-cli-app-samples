import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { signBody } from "../../src/webhook/signature.js";

describe("signBody", () => {
  it("produces the same HMAC-SHA256 base64 as LINE's spec", () => {
    const secret = "mysecret";
    const body = '{"events":[]}';
    const expected = createHmac("sha256", secret).update(body).digest("base64");
    expect(signBody(secret, body)).toBe(expected);
  });
});
