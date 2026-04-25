import { describe, expect, it } from "vitest";
import { validate } from "../../src/mock/middleware/validate.js";

describe("validate() boot-time schema-ref guard", () => {
  it("accepts a known schema ref under #/components/schemas/", () => {
    expect(() =>
      validate({ requestSchema: "#/components/schemas/PushMessageRequest" })
    ).not.toThrow();
  });

  it("throws on a typo'd schema name", () => {
    expect(() =>
      validate({ requestSchema: "#/components/schemas/PushMessageReq" })
    ).toThrowError(/not present in specs\/messaging-api\.yml/);
  });

  it("throws when the ref is missing the #/components/schemas/ prefix", () => {
    expect(() =>
      validate({ requestSchema: "PushMessageRequest" })
    ).toThrowError(/must start with "#\/components\/schemas\/"/);
  });

  it("validates responseSchema with the same guard", () => {
    expect(() =>
      validate({ responseSchema: "#/components/schemas/NotARealResponse" })
    ).toThrowError(/not present in specs\/messaging-api\.yml/);
  });
});
