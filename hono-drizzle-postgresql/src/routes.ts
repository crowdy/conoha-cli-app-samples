import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, ilike, sql, and, or, desc, count } from "drizzle-orm";
import { db } from "./db/index";
import { bookmarks } from "./db/schema";

// Only allow http/https URLs (prevents javascript: and data: URLs)
const httpUrl = z
  .string()
  .url()
  .refine(
    (u) => {
      try {
        const proto = new URL(u).protocol;
        return proto === "http:" || proto === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL must use http or https protocol" }
  );

const BookmarkSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    url: z.string().url().openapi({ example: "https://hono.dev" }),
    title: z.string().openapi({ example: "Hono - Web framework" }),
    description: z
      .string()
      .nullable()
      .openapi({ example: "Fast, lightweight web framework" }),
    tags: z
      .array(z.string())
      .openapi({ example: ["typescript", "web"] }),
    createdAt: z.string().openapi({ example: "2026-01-01T00:00:00.000Z" }),
    updatedAt: z.string().openapi({ example: "2026-01-01T00:00:00.000Z" }),
  })
  .openapi("Bookmark");

const CreateBookmarkSchema = z
  .object({
    url: httpUrl.openapi({ example: "https://hono.dev" }),
    title: z.string().min(1).max(200).openapi({ example: "Hono" }),
    description: z
      .string()
      .max(2000)
      .optional()
      .openapi({ example: "Web framework" }),
    tags: z
      .array(z.string().max(50))
      .max(20)
      .optional()
      .default([])
      .openapi({ example: ["typescript"] }),
  })
  .openapi("CreateBookmark");

const ErrorSchema = z
  .object({
    message: z.string().openapi({ example: "Not found" }),
  })
  .openapi("Error");

const IdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "id", in: "path" }, example: 1 }),
});

const listRoute = createRoute({
  method: "get",
  path: "/api/bookmarks",
  tags: ["Bookmarks"],
  request: {
    query: z.object({
      tag: z.string().optional().openapi({ description: "Filter by tag" }),
      q: z.string().optional().openapi({ description: "Search title and URL" }),
      page: z
        .string()
        .optional()
        .openapi({ description: "Page number", example: "1" }),
      limit: z
        .string()
        .optional()
        .openapi({ description: "Items per page", example: "20" }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            bookmarks: z.array(BookmarkSchema),
            total: z.number(),
            page: z.number(),
            limit: z.number(),
          }),
        },
      },
      description: "List of bookmarks",
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/bookmarks/{id}",
  tags: ["Bookmarks"],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: BookmarkSchema } },
      description: "Bookmark detail",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Not found",
    },
  },
});

const createBookmarkRoute = createRoute({
  method: "post",
  path: "/api/bookmarks",
  tags: ["Bookmarks"],
  request: {
    body: {
      content: { "application/json": { schema: CreateBookmarkSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: BookmarkSchema } },
      description: "Created bookmark",
    },
  },
});

const updateRoute = createRoute({
  method: "put",
  path: "/api/bookmarks/{id}",
  tags: ["Bookmarks"],
  request: {
    params: IdParamSchema,
    body: {
      content: { "application/json": { schema: CreateBookmarkSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: BookmarkSchema } },
      description: "Updated bookmark",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Not found",
    },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/bookmarks/{id}",
  tags: ["Bookmarks"],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: BookmarkSchema } },
      description: "Deleted bookmark",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Not found",
    },
  },
});

function formatBookmark(row: typeof bookmarks.$inferSelect) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Escape LIKE wildcards so user input is treated literally
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export function registerRoutes(app: OpenAPIHono) {
  app.openapi(listRoute, async (c) => {
    const { tag, q, page: pageStr, limit: limitStr } = c.req.valid("query");
    const page = Math.max(Number(pageStr) || 1, 1);
    const limit = Math.min(Math.max(Number(limitStr) || 20, 1), 100);

    const conditions = [];
    if (tag) {
      conditions.push(sql`${bookmarks.tags} @> ARRAY[${tag}]::text[]`);
    }
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(
        or(ilike(bookmarks.title, pattern), ilike(bookmarks.url, pattern))
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select()
      .from(bookmarks)
      .where(where)
      .orderBy(desc(bookmarks.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const [{ total }] = await db
      .select({ total: count() })
      .from(bookmarks)
      .where(where);

    return c.json(
      { bookmarks: items.map(formatBookmark), total, page, limit },
      200
    );
  });

  app.openapi(getRoute, async (c) => {
    const { id } = c.req.valid("params");
    const [row] = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.id, id));
    if (!row) return c.json({ message: "Not found" }, 404);
    return c.json(formatBookmark(row), 200);
  });

  app.openapi(createBookmarkRoute, async (c) => {
    const body = c.req.valid("json");
    const [created] = await db
      .insert(bookmarks)
      .values({
        url: body.url,
        title: body.title,
        description: body.description ?? null,
        tags: body.tags,
      })
      .returning();
    return c.json(formatBookmark(created), 201);
  });

  app.openapi(updateRoute, async (c) => {
    const { id } = c.req.valid("params");
    const body = c.req.valid("json");
    const [updated] = await db
      .update(bookmarks)
      .set({
        url: body.url,
        title: body.title,
        description: body.description ?? null,
        tags: body.tags,
        updatedAt: new Date(),
      })
      .where(eq(bookmarks.id, id))
      .returning();
    if (!updated) return c.json({ message: "Not found" }, 404);
    return c.json(formatBookmark(updated), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("params");
    const [deleted] = await db
      .delete(bookmarks)
      .where(eq(bookmarks.id, id))
      .returning();
    if (!deleted) return c.json({ message: "Not found" }, 404);
    return c.json(formatBookmark(deleted), 200);
  });
}
