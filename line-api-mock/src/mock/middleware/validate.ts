import type { MiddlewareHandler } from "hono";
import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { errors } from "../../lib/errors.js";

type OpenApiSpec = {
  components?: { schemas?: Record<string, unknown> };
};

const spec = yaml.load(
  readFileSync(resolve(process.cwd(), "specs/messaging-api.yml"), "utf8")
) as OpenApiSpec;

const ajv = new Ajv({
  strict: false,
  allErrors: true,
  // LINE spec uses OpenAPI 3 $ref paths; bake them into ajv root schemas.
  schemas: spec.components?.schemas
    ? Object.fromEntries(
        Object.entries(spec.components.schemas).map(([name, s]) => [
          `#/components/schemas/${name}`,
          rewriteRefs(s) as AnySchema,
        ])
      )
    : {},
});
addFormats(ajv);

function rewriteRefs(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(rewriteRefs);
  if (s && typeof s === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") {
        // Keep as-is — ajv's schema registry uses the full path as the id.
        o[k] = v;
      } else {
        o[k] = rewriteRefs(v);
      }
    }
    // OpenAPI discriminator.mapping → add enum constraint to the discriminator
    // property so AJV rejects unknown discriminator values.
    const disc = o["discriminator"] as
      | { propertyName?: string; mapping?: Record<string, string> }
      | undefined;
    if (disc?.propertyName && disc.mapping) {
      const allowedValues = Object.keys(disc.mapping);
      const props = o["properties"] as Record<string, unknown> | undefined;
      if (props?.[disc.propertyName]) {
        const propSchema = props[disc.propertyName] as Record<string, unknown>;
        if (!propSchema["enum"]) {
          props[disc.propertyName] = { ...propSchema, enum: allowedValues };
        }
      }
    }
    return o;
  }
  return s;
}

function compileOnce(
  cache: Map<string, ValidateFunction>,
  ref: string
): ValidateFunction | null {
  if (cache.has(ref)) return cache.get(ref)!;
  try {
    const fn = ajv.getSchema(ref) ?? ajv.compile({ $ref: ref });
    cache.set(ref, fn);
    return fn;
  } catch {
    return null;
  }
}

const reqCache = new Map<string, ValidateFunction>();
const resCache = new Map<string, ValidateFunction>();

export interface ValidateOpts {
  requestSchema?: string; // e.g. "#/components/schemas/PushMessageRequest"
  responseSchema?: string;
}

export function validate(opts: ValidateOpts): MiddlewareHandler {
  return async (c, next) => {
    if (opts.requestSchema && c.req.method !== "GET") {
      const ct = c.req.header("content-type") ?? "";
      if (ct.includes("application/json")) {
        const v = compileOnce(reqCache, opts.requestSchema);
        if (v) {
          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return errors.badRequest(c, "Invalid JSON body");
          }
          if (!v(body)) {
            return errors.badRequest(
              c,
              "Request validation failed",
              v.errors?.map((e) => ({
                property: e.instancePath || e.schemaPath,
                message: e.message ?? "invalid",
              }))
            );
          }
          // Stash parsed body for handler; Hono's c.req.json() is not re-readable.
          c.set("validatedBody" as never, body as never);
        }
      }
    }

    await next();

    if (process.env.NODE_ENV !== "production" && opts.responseSchema) {
      const resCt = c.res.headers.get("content-type") ?? "";
      if (resCt.includes("application/json")) {
        const v = compileOnce(resCache, opts.responseSchema);
        if (v) {
          try {
            const body = await c.res.clone().json();
            if (!v(body)) {
              console.error(
                "[validate] RESPONSE SCHEMA DRIFT",
                opts.responseSchema,
                v.errors
              );
            }
          } catch {
            /* ignore */
          }
        }
      }
    }
  };
}
