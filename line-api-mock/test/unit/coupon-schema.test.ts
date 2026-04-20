import { describe, expect, it } from "vitest";
import Ajv, { type AnySchema } from "ajv";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type OpenApiSpec = {
  components?: { schemas?: Record<string, unknown> };
};

const spec = yaml.load(
  readFileSync(resolve(process.cwd(), "specs/messaging-api.yml"), "utf8")
) as OpenApiSpec;

function rewriteRefs(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(rewriteRefs);
  if (s && typeof s === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      o[k] = k === "$ref" && typeof v === "string" ? v : rewriteRefs(v);
    }
    return o;
  }
  return s;
}

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
for (const [name, s] of Object.entries(spec.components!.schemas!)) {
  ajv.addSchema(rewriteRefs(s) as AnySchema, `#/components/schemas/${name}`);
}
const validate = ajv.getSchema("#/components/schemas/CouponCreateRequest")!;

function base() {
  return {
    title: "Summer Sale",
    startTimestamp: 1_700_000_000,
    endTimestamp: 1_800_000_000,
    maxUseCountPerTicket: 1,
    timezone: "ASIA_TOKYO",
    visibility: "UNLISTED",
    acquisitionCondition: { type: "normal" },
    reward: {
      type: "discount",
      priceInfo: { type: "percentage", percentage: 10 },
    },
  };
}

describe("CouponCreateRequest schema", () => {
  it("accepts a minimal valid payload", () => {
    expect(validate(base())).toBe(true);
  });

  it("rejects missing title", () => {
    const p: any = base();
    delete p.title;
    expect(validate(p)).toBe(false);
  });

  it("rejects unknown timezone enum value", () => {
    const p: any = base();
    p.timezone = "ASIA_SEOUL";
    expect(validate(p)).toBe(false);
  });

  it("rejects maxUseCountPerTicket > 1", () => {
    const p: any = base();
    p.maxUseCountPerTicket = 5;
    expect(validate(p)).toBe(false);
  });

  it("rejects title longer than 60 chars", () => {
    const p: any = base();
    p.title = "x".repeat(61);
    expect(validate(p)).toBe(false);
  });
});
