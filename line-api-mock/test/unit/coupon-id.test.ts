import { describe, expect, it } from "vitest";
import { couponId } from "../../src/lib/id.js";

describe("couponId()", () => {
  it("returns a string starting with COUPON_", () => {
    expect(couponId()).toMatch(/^COUPON_/);
  });

  it("contains base64url body (no +/=)", () => {
    const id = couponId();
    const body = id.replace(/^COUPON_/, "");
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.length).toBeGreaterThanOrEqual(16);
  });

  it("is unique across many calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(couponId());
    expect(set.size).toBe(1000);
  });
});
