import { describe, expect, it } from "vitest";
import { validateSignature } from "@line/bot-sdk";
import { signBody } from "../../src/webhook/signature.js";

describe("webhook signature is valid per @line/bot-sdk", () => {
  it("validateSignature(body, secret, signature) === true", () => {
    const secret = "s3cret-for-testing";
    const body = JSON.stringify({
      destination: "U0",
      events: [{ type: "message", message: { type: "text", text: "x" } }],
    });
    const signature = signBody(secret, body);
    expect(validateSignature(body, secret, signature)).toBe(true);
  });
});
