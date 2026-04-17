import type { Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";

interface LineErrorBody {
  message: string;
  details?: Array<{ message: string; property?: string }>;
}

export function lineError(
  c: Context,
  status: StatusCode,
  body: LineErrorBody
) {
  return c.json(body, status);
}

export const errors = {
  unauthorized: (c: Context) =>
    lineError(c, 401, {
      message: "Authentication failed due to the expired access token",
    }),
  missingAuth: (c: Context) =>
    lineError(c, 401, {
      message: "Authentication failed due to the missing access token",
    }),
  notFound: (c: Context) =>
    lineError(c, 404, { message: "The resource not found." }),
  notImplemented: (c: Context) =>
    lineError(c, 501, { message: "Not implemented in line-api-mock" }),
  badRequest: (c: Context, message: string, details?: LineErrorBody["details"]) =>
    lineError(c, 400, { message, details }),
};
