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
): ValidateFunction {
  if (cache.has(ref)) return cache.get(ref)!;
  // No try/catch swallow: a typo or stale ref must surface immediately
  // (caller route 500 + stderr stack) so it is caught in CI rather than
  // becoming a silent "this endpoint is unvalidated" surprise. assertSchemaRefExists
  // already validates the ref at validate() construction time, so reaching this
  // line with a missing ref means the spec changed under us at runtime.
  const fn = ajv.getSchema(ref) ?? ajv.compile({ $ref: ref });
  cache.set(ref, fn);
  return fn;
}

const reqCache = new Map<string, ValidateFunction>();
const resCache = new Map<string, ValidateFunction>();

const SCHEMA_REF_PREFIX = "#/components/schemas/";
const knownSchemaNames = new Set(
  Object.keys(spec.components?.schemas ?? {})
);

function assertSchemaRefExists(ref: string, role: "request" | "response"): void {
  if (!ref.startsWith(SCHEMA_REF_PREFIX)) {
    throw new Error(
      `[validate] ${role}Schema must start with "${SCHEMA_REF_PREFIX}", got: ${ref}`
    );
  }
  const name = ref.slice(SCHEMA_REF_PREFIX.length);
  if (!knownSchemaNames.has(name)) {
    throw new Error(
      `[validate] ${role}Schema "${ref}" is not present in specs/messaging-api.yml ` +
        `(spec exposes ${knownSchemaNames.size} schemas under components/schemas). ` +
        `Did you typo the schema name or forget to refresh the vendored spec?`
    );
  }
}

export interface ValidateOpts {
  requestSchema?: string; // e.g. "#/components/schemas/PushMessageRequest"
  responseSchema?: string;
}

export function validate(opts: ValidateOpts): MiddlewareHandler {
  // Boot-time validation: all `validate({...})` calls happen at module load,
  // so a typo here crashes the process before serving traffic instead of
  // silently disabling the check.
  if (opts.requestSchema) assertSchemaRefExists(opts.requestSchema, "request");
  if (opts.responseSchema) assertSchemaRefExists(opts.responseSchema, "response");

  return async (c, next) => {
    if (opts.requestSchema && c.req.method !== "GET") {
      const ct = c.req.header("content-type") ?? "";
      if (ct.includes("application/json")) {
        const v = compileOnce(reqCache, opts.requestSchema);
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
        // Hono caches parsed JSON internally, so handlers can call
        // `c.req.json()` again without re-reading the stream. We do not
        // need to stash the body via `c.set`.
      }
    }

    await next();

    // Success-response schemas only describe 2xx bodies. Skip for 4xx/5xx
    // so guard-produced error responses (badRequest, unauthorized, ...) do
    // not trigger spurious "SCHEMA DRIFT" logs.
    if (
      process.env.NODE_ENV !== "production" &&
      opts.responseSchema &&
      c.res.status >= 200 &&
      c.res.status < 300
    ) {
      const resCt = c.res.headers.get("content-type") ?? "";
      if (resCt.includes("application/json")) {
        const v = compileOnce(resCache, opts.responseSchema);
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
  };
}
