# LINE API Mock Sample App Design

## Overview

LINE Messaging API の OpenAPI 仕様に準拠したモックサーバー。LINE 公式アカウントを持たない開発者が、自分の LINE Bot 実装を実 LINE に依存せずに開発・テストできる環境を提供する。

差別化ポイントは **Webhook エミュレーション**:管理 UI から「仮想ユーザーが Bot に話しかける」シナリオを作成すると、モックが LINE と同じ署名ヘッダー付きで開発者の Webhook URL に POST し、Bot が reply API を呼ぶと会話 UI に表示される。これにより、公式アカウントなしでも双方向の開発ループが完結する。

スタックは Hono + TypeScript + Drizzle + PostgreSQL。既存サンプル `hono-drizzle-postgresql` の延長として読めるようにする。

## Directory Structure

```
line-api-mock/
├── compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── specs/
│   ├── messaging-api.yml          # line-openapi から vendored
│   └── README.md                   # 取得元・バージョン明記
├── src/
│   ├── index.ts                   # Hono エントリ (ルーター登録)
│   ├── db/
│   │   ├── client.ts              # Drizzle クライアント
│   │   ├── schema.ts              # 全テーブルスキーマ
│   │   └── seed.ts                # 初回起動時の default channel/user 投入
│   ├── mock/                      # LINE API mock 実装
│   │   ├── oauth.ts               # /v2/oauth/*, /v3/token/*
│   │   ├── message.ts             # /v2/bot/message/*
│   │   ├── profile.ts             # /v2/bot/profile/*
│   │   ├── webhook-endpoint.ts    # /v2/bot/channel/webhook/*
│   │   ├── content.ts             # /v2/bot/message/{id}/content
│   │   └── middleware/
│   │       ├── auth.ts            # Bearer トークン検証
│   │       ├── request-log.ts     # api_logs 書き込み
│   │       └── validate.ts        # ajv による OpenAPI スキーマ検証
│   ├── webhook/
│   │   ├── dispatcher.ts          # 開発者 Bot への署名付き POST
│   │   └── signature.ts           # HMAC-SHA256 (Channel Secret)
│   ├── admin/
│   │   ├── routes.ts              # /admin/* Hono ルーター
│   │   ├── pages/                 # JSX ページコンポーネント
│   │   │   ├── Layout.tsx
│   │   │   ├── Channels.tsx
│   │   │   ├── Users.tsx
│   │   │   ├── Conversation.tsx
│   │   │   ├── WebhookLog.tsx
│   │   │   └── ApiLog.tsx
│   │   └── sse.ts                 # Server-Sent Events エンドポイント
│   ├── types/
│   │   └── line-api.d.ts          # openapi-typescript 生成 (コミット対象)
│   └── lib/
│       ├── id.ts                  # 14桁英数字 ID 生成 (LINE 風)
│       └── errors.ts              # LINE 形式エラーレスポンス
├── drizzle/                       # マイグレーションファイル
│   └── *.sql
├── scripts/
│   └── gen-types.sh               # openapi-typescript 実行
├── test/
│   ├── unit/                      # ハンドラー単体テスト
│   └── e2e/                       # webhook 往復 + 管理 UI スモーク
└── README.md
```

## Container Architecture

```
[Browser / Bot] → :3000 [Hono app]
                          │
                          ├─ /v2/*, /v3/*     (LINE mock API)
                          ├─ /admin/*          (管理 UI, HTMX)
                          ├─ /admin/events     (SSE)
                          ├─ /docs             (Swagger UI)
                          └─ /openapi.yaml     (vendored spec)
                          │
                          └─ webhook dispatcher (同一プロセス)
                                │ (HTTP POST with X-Line-Signature)
                                ▼
                          [開発者 Bot の webhook URL]

[Hono app] ──▶ :5432 [PostgreSQL 17]
```

### Services

| Service | Image                | Port           | Role                              |
|---------|----------------------|----------------|-----------------------------------|
| app     | node:22-alpine build | 3000 (public)  | LINE mock API + admin UI + SSE    |
| db      | postgres:17-alpine   | 5432 (internal)| 全データ永続化                    |

## Scope (v1)

`line-openapi` の `messaging-api.yml` のうち、以下のエンドポイントを実装する:

### Channel Access Token
- `POST /v2/oauth/accessToken` — channel_id/secret から短期トークン発行
- `POST /v2/oauth/verify` — トークン検証
- `POST /v2/oauth/revoke` — トークン無効化
- `POST /v3/token/*` — JWT assertion flow(署名検証は省略、形式のみ準拠)

### Message Send
- `POST /v2/bot/message/push` — 指定ユーザーへ送信
- `POST /v2/bot/message/reply` — replyToken に対する返信
- `POST /v2/bot/message/multicast` — 複数ユーザーへ送信
- `POST /v2/bot/message/broadcast` — 全友達へ送信
- `POST /v2/bot/message/narrowcast` — 属性指定送信 (stub)
- `GET /v2/bot/message/progress/narrowcast` — 進捗照会 (常に succeeded を返す stub)

### Message Utility
- `GET /v2/bot/message/quota` — 月次クォータ (固定値返却)
- `GET /v2/bot/message/quota/consumption` — 消費量 (DB カウント)
- `GET /v2/bot/message/{messageId}/content` — 保存メディアのバイト列
- `GET /v2/bot/message/{messageId}/content/transcoding` — 常に succeeded

### Profile
- `GET /v2/bot/profile/{userId}` — 仮想ユーザープロフィール

### Webhook Endpoint
- `GET /v2/bot/channel/webhook/endpoint` — 現在の URL
- `PUT /v2/bot/channel/webhook/endpoint` — URL 設定
- `POST /v2/bot/channel/webhook/test` — 指定 URL に疎通テスト

### v2 以降に延期 (Out of Scope)
- Rich menu / LIFF / Insight / Audience / MLS / Shop / module-attach
- 上記のエンドポイントは Swagger UI には表示するが、実行すると `501 Not Implemented` を返す

## Data Model (Drizzle Schema)

```typescript
// channels — LINE 公式アカウントに相当
channels {
  id: serial pk
  channel_id: text unique            // 数字 10桁 (LINE 風)
  channel_secret: text               // HMAC 用
  name: text
  webhook_url: text nullable         // 開発者 Bot の URL
  webhook_enabled: boolean default true
  created_at: timestamp
}

// access_tokens — 発行済みトークン
access_tokens {
  id: serial pk
  channel_id: int fk → channels.id
  token: text unique                 // Bearer
  kid: text nullable                 // v3 token 用
  expires_at: timestamp
  revoked: boolean default false
  created_at: timestamp
}

// virtual_users — モック上の LINE ユーザー
virtual_users {
  id: serial pk
  user_id: text unique               // "U" + 32 hex (LINE 風)
  display_name: text
  picture_url: text nullable
  language: text default 'ja'
  created_at: timestamp
}

// channel_friends — どのチャンネルが誰を友達に持つか
channel_friends {
  channel_id: int fk
  user_id: int fk
  blocked: boolean default false
  pk (channel_id, user_id)
}

// messages — Bot から送信された / User から受信したメッセージ
messages {
  id: serial pk
  message_id: text unique            // 数字 18桁 (LINE 風)
  channel_id: int fk
  virtual_user_id: int fk
  direction: enum('bot_to_user', 'user_to_bot')
  type: text                         // 'text', 'image', 'sticker', 'location', ...
  payload: jsonb                     // LINE メッセージオブジェクト全体
  reply_token: text nullable         // bot_to_user の reply 応答用
  created_at: timestamp
}

// message_contents — image/audio/video/file の実バイト
message_contents {
  message_id: int fk pk
  content_type: text
  data: bytea
}

// webhook_deliveries — 開発者 Bot への送信ログ
webhook_deliveries {
  id: serial pk
  channel_id: int fk
  event_payload: jsonb               // 送信した LINE event body
  signature: text                    // 送信した X-Line-Signature
  target_url: text
  status_code: int nullable
  response_body: text nullable
  error: text nullable
  duration_ms: int nullable
  created_at: timestamp
}

// api_logs — Bot が mock に投げた全リクエスト
api_logs {
  id: serial pk
  channel_id: int nullable fk
  method: text
  path: text
  request_headers: jsonb
  request_body: jsonb nullable
  response_status: int
  response_body: jsonb nullable
  duration_ms: int
  created_at: timestamp
}
```

## OpenAPI Spec Handling

1. **Vendoring**: `specs/messaging-api.yml` を `line-openapi` リポジトリから取得し、`specs/README.md` に取得元 URL とコミット SHA を記録
2. **型生成**: `openapi-typescript` で `src/types/line-api.d.ts` を生成しコミット (ビルド時再生成せず、スクリプトで手動更新)
3. **ランタイム検証**: `ajv` で YAML をロードし、各ハンドラーがリクエスト/レスポンスの両方をスキーマ検証。リクエスト違反は `400` + LINE 形式エラー(開発者のバグ)、レスポンス違反は `500` + サーバーログ(モック実装のバグを早期発見)
4. **Swagger UI**: `/docs` で `/openapi.yaml` を消費する Swagger UI を配信 (CDN から hosted)

`@hono/zod-openapi` は使わない。zod で LINE OpenAPI 全体を書き直すコストが大きく、vendored YAML を単一ソースとして扱う方が仕様追従しやすい。

## Authentication

- Bearer トークンをリクエストから抽出し `access_tokens` テーブルで検証
- 期限切れ / 失効 / 存在しない場合は LINE 実機と同じ形式で 401:
  ```json
  { "message": "Authentication failed due to the expired access token" }
  ```
- `/v2/oauth/*`, `/v3/token/*` は認証不要

## Webhook Emulation Flow

1. 管理 UI の Conversation 画面で仮想ユーザーが Bot 宛にメッセージ作成
2. Hono が LINE Webhook Event 形式のペイロードを生成:
   ```json
   {
     "destination": "U_bot_id",
     "events": [{
       "type": "message",
       "message": { "type": "text", "id": "...", "text": "..." },
       "source": { "type": "user", "userId": "U..." },
       "timestamp": 1714000000000,
       "replyToken": "...",
       "mode": "active"
     }]
   }
   ```
3. Channel Secret で `X-Line-Signature` (HMAC-SHA256, Base64) を計算
4. `channels.webhook_url` に POST (10秒タイムアウト)
5. レスポンスを `webhook_deliveries` に記録
6. SSE で管理 UI の Webhook Log に即座に反映
7. 開発者 Bot が `/v2/bot/message/reply` を呼ぶと `reply_token` を照合し、`messages` に `bot_to_user` 方向で保存、SSE で会話 UI に反映

## Admin UI

- 技術: Hono JSX + HTMX 2.x + Tailwind CSS CDN (ビルド不要)
- 認証: HTTP Basic Auth。環境変数 `ADMIN_USER` / `ADMIN_PASSWORD` が両方セットされている時のみ有効化(両方空なら認証なしで、README で本番展開時は必須と記載)。ブラウザが自動で `Authorization` ヘッダーを付けるため HTMX リクエストもそのまま通る

### Pages

| Path                                        | 役割                                            |
|---------------------------------------------|-------------------------------------------------|
| `/admin`                                    | ダッシュボード(チャンネル一覧、今日の送信数)    |
| `/admin/channels`                           | チャンネル CRUD                                 |
| `/admin/channels/:id`                       | webhook URL 編集、Access Token 発行 UI          |
| `/admin/users`                              | 仮想ユーザー CRUD                               |
| `/admin/conversations/:channelId/:userId`   | 会話 UI (SSE で bot 返信をリアルタイム反映)     |
| `/admin/webhook-log`                        | 発送ログ (status, 応答本文、再送ボタン)         |
| `/admin/api-log`                            | Bot → mock の全リクエストログ                   |

### First-Run Seeding

初回起動時に以下を作成し、コンテナログに認証情報を出力:

```
[line-api-mock] Seeded default channel:
  channel_id:     1234567890
  channel_secret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  access_token:   xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  webhook_url:    (未設定 - 管理 UI から設定してください)
Default virtual user:
  user_id:        U00000000000000000000000000000001
  display_name:   テストユーザー
Admin URL: http://<host>:3000/admin
```

## Environment Variables

| Variable         | Default                                 | 説明                                    |
|------------------|-----------------------------------------|-----------------------------------------|
| `DATABASE_URL`   | `postgres://mock:mock@db:5432/mock`     | PostgreSQL 接続文字列                   |
| `PORT`           | `3000`                                  | HTTP ポート                             |
| `APP_BASE_URL`   | `http://localhost:3000`                 | Swagger UI や Admin 画面内の自己参照    |
| `ADMIN_USER`     | (空)                                    | 管理 UI Basic Auth ユーザー名           |
| `ADMIN_PASSWORD` | (空)                                    | 管理 UI Basic Auth パスワード           |
| `TOKEN_TTL_SEC`  | `2592000`                               | 発行トークン有効期限(デフォルト30日)   |

## Error Responses

LINE 実機と同じ JSON 形式を維持:

```json
// 400
{ "message": "The property, 'to' must be specified.", "details": [...] }
// 401
{ "message": "Authentication failed due to the expired access token" }
// 404
{ "message": "The resource not found." }
// 501 (out-of-scope endpoints)
{ "message": "Not implemented in line-api-mock" }
```

## Deployment (ConoHa)

```bash
conoha server create --name line-mock --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
cd line-api-mock
conoha app init line-mock --app-name line-mock
conoha app deploy line-mock --app-name line-mock
```

- 推奨フレーバー: `g2l-t-2` (2GB) — Node + Postgres 同居のため
- デプロイ後 `conoha app logs line-mock --app-name line-mock` でシード値確認
- `http://<VPS IP>:3000/admin` で管理画面、`http://<VPS IP>:3000/docs` で Swagger UI

## Testing Strategy

- **単体 (Vitest)**: 各 mock エンドポイントを ajv 応答スキーマ検証付きで
- **統合 (Vitest + Testcontainers-node)**: 実 Postgres 起動、webhook dispatch はローカル HTTP モックサーバーで受信して署名検証
- **E2E スモーク (Playwright)**: 管理 UI で channel 作成 → 仮想ユーザー発言 → テスト用 Echo Bot が reply → 会話画面に反映 を 1 シナリオ

## What This Sample Does NOT Include

- Rich menu / LIFF / Insight / Audience / MLS / Shop / module-attach の実装 (Swagger UI にのみ表示、呼ぶと 501)
- 実 LINE Platform との互換性(あくまで仕様形式の準拠、内部挙動は簡略化)
- JWT assertion (v3 token) の署名検証
- レート制限・クォータ強制
- マルチテナント的な権限分離(全チャンネル・全ログを Admin UI から閲覧可能)
- HTTPS 終端 (必要なら `nginx-reverse-proxy` サンプルと組み合わせる)
