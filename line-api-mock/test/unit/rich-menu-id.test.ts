import { describe, expect, it } from "vitest";
import { richMenuId } from "../../src/lib/id.js";

describe("richMenuId()", () => {
  it("returns a string matching LINE format", () => {
    expect(richMenuId()).toMatch(/^richmenu-[0-9a-f]{32}$/);
  });

  it("is unique across many calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(richMenuId());
    expect(set.size).toBe(1000);
  });
});
