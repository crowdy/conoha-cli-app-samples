import { describe, expect, it } from "vitest";
import { truncateBodyForLog } from "../../src/mock/middleware/request-log.js";

describe("truncateBodyForLog", () => {
  it("returns small bodies unchanged", () => {
    const body = { hello: "world", n: 1 };
    expect(truncateBodyForLog(body)).toBe(body);
  });

  it("returns null/undefined unchanged", () => {
    expect(truncateBodyForLog(null)).toBeNull();
    expect(truncateBodyForLog(undefined)).toBeUndefined();
  });

  it("replaces a >4KB body with a truncation marker carrying preview + size", () => {
    // Build something that serializes to well over 4KB.
    const big = { blob: "x".repeat(8000) };
    const out = truncateBodyForLog(big) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
    expect(typeof out._originalBytes).toBe("number");
    expect(out._originalBytes as number).toBeGreaterThan(4096);
    expect(typeof out._preview).toBe("string");
    expect((out._preview as string).length).toBeLessThanOrEqual(1024);
  });

  it("does not crash on a circular structure (drops to null)", () => {
    type Node = { self?: Node };
    const a: Node = {};
    a.self = a;
    expect(truncateBodyForLog(a)).toBeNull();
  });
});
