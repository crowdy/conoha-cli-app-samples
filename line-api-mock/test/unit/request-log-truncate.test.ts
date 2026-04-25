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

  it("replaces a >4KB ASCII body with a truncation marker carrying preview + size", () => {
    // Build something that serializes to well over 4KB.
    const big = { blob: "x".repeat(8000) };
    const out = truncateBodyForLog(big) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
    expect(typeof out._originalBytes).toBe("number");
    expect(out._originalBytes as number).toBeGreaterThan(4096);
    expect(out._previewBytes).toBe(1024);
    expect(typeof out._preview).toBe("string");
    expect(Buffer.byteLength(out._preview as string, "utf8")).toBeLessThanOrEqual(
      1024
    );
  });

  it("counts UTF-8 bytes, not JS code units, when checking the cap", () => {
    // 2000 × 'あ' → 2000 chars but 6000 UTF-8 bytes (3 B each).
    // A code-unit cap would let this through; a byte cap must truncate.
    const big = { msg: "あ".repeat(2000) };
    const out = truncateBodyForLog(big) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
    expect(out._originalBytes as number).toBeGreaterThan(6000);
    expect(out._previewBytes).toBe(1024);
  });

  it("leaves no lone surrogate or invalid UTF-8 in _preview when slicing emoji", () => {
    // Each 🎉 is a UTF-16 surrogate pair (2 code units, 4 UTF-8 bytes).
    // A naïve String#slice could leave a lone high surrogate at the boundary.
    // Need >4KB UTF-8 to trigger truncation: 1500 × 4 B = 6000 B. The leading
    // "x" shifts the byte offset so the 1024-byte boundary lands mid-emoji.
    const big = { msg: "x" + "🎉".repeat(1500) };
    const out = truncateBodyForLog(big) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
    const preview = out._preview as string;
    // No lone high or low surrogates.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(preview)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(preview)).toBe(false);
    // Round-trip through UTF-8 must be lossless (no replacement chars
    // introduced by re-encoding the preview itself).
    const reencoded = Buffer.from(preview, "utf8").toString("utf8");
    expect(reencoded).toBe(preview);
  });

  it("does not crash on a circular structure (drops to null)", () => {
    type Node = { self?: Node };
    const a: Node = {};
    a.self = a;
    expect(truncateBodyForLog(a)).toBeNull();
  });
});
