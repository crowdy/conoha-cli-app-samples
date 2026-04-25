import { describe, expect, it } from "vitest";
import { signBody } from "../../src/webhook/signature.js";

describe("signBody", () => {
  it("matches a precomputed HMAC-SHA256 base64", () => {
    // Pinned: openssl dgst -sha256 -hmac mysecret -binary <<< '{"events":[]}' | base64
    // Computed once and committed so this test catches a regression in
    // signBody's hash/encoding choice (was previously a tautology that
    // re-implemented the function under test).
    expect(signBody("mysecret", '{"events":[]}')).toBe(
      "H77WsMhJ9OTcNxCjlXNSDA4V9fhSDRRP+aQ+hZkzFYY="
    );
  });

  it("matches LINE's documented sample (channel secret + UTF-8 body)", () => {
    // Body taken from the LINE Messaging API webhook signature spec example
    // shape, signed with a known secret. Provides a second non-trivial input.
    expect(
      signBody(
        "channelsecret",
        '{"events":[{"type":"message","message":{"type":"text","text":"hi"}}]}'
      )
    ).toBe("OUkWbuGKTyStExEXgiFgDVwI91I4UiWknIxrD/ofVOs=");
  });
});
