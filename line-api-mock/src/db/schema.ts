import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull().unique(),
  channelSecret: text("channel_secret").notNull(),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url"),
  webhookEnabled: boolean("webhook_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accessTokens = pgTable("access_tokens", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  kid: text("kid"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const virtualUsers = pgTable("virtual_users", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  pictureUrl: text("picture_url"),
  language: text("language").notNull().default("ja"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const channelFriends = pgTable(
  "channel_friends",
  {
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => virtualUsers.id, { onDelete: "cascade" }),
    blocked: boolean("blocked").notNull().default(false),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.userId] }) })
);

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull().unique(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  virtualUserId: integer("virtual_user_id")
    .notNull()
    .references(() => virtualUsers.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // 'bot_to_user' | 'user_to_bot'
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  replyToken: text("reply_token"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messageContents = pgTable("message_contents", {
  messageId: integer("message_id")
    .primaryKey()
    .references(() => messages.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  eventPayload: jsonb("event_payload").notNull(),
  signature: text("signature").notNull(),
  targetUrl: text("target_url").notNull(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiLogs = pgTable("api_logs", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").references(() => channels.id, {
    onDelete: "set null",
  }),
  method: text("method").notNull(),
  path: text("path").notNull(),
  requestHeaders: jsonb("request_headers").notNull(),
  requestBody: jsonb("request_body"),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body"),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  couponId: text("coupon_id").notNull().unique(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("RUNNING"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
