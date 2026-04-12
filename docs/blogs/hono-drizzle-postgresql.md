---
title: conoha-cliでHono + Drizzle + PostgreSQLのTypeScript製REST APIをConoHa VPSにワンコマンドデプロイ
tags: Hono Drizzle PostgreSQL TypeScript Conoha
author: crowdy
slide: false
---
## はじめに

2026年、TypeScriptでバックエンドAPIを書くならどのフレームワークを選びますか？Express.jsは枯れた定番ですが、TypeScriptネイティブで軽量・高速・モダンという条件で選ぶと、最近の候補は **[Hono](https://hono.dev/)** 一択と言ってもよい状況です。

そしてORMもまた、`Sequelize` や `TypeORM` から **[Drizzle ORM](https://orm.drizzle.team/)** へと主役が移りつつあります。Drizzleは「SQLをそのままTypeScriptで書く」という発想のORMで、型安全性とパフォーマンスを両立しています。

この記事では、Hono + Drizzle + PostgreSQL で作ったブックマーク管理REST APIを、ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。注目ポイントは、`@hono/zod-openapi` による **OpenAPI (Swagger UI) の自動生成** です。Zodスキーマを1回書くだけで、バリデーションとAPIドキュメントの両方が手に入ります。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Hono** v4 | Web フレームワーク（TypeScriptネイティブ、軽量、高速） |
| **@hono/zod-openapi** | Zodスキーマから OpenAPI 仕様を自動生成 |
| **@hono/swagger-ui** | Swagger UI を `/doc` でホスティング |
| **Drizzle ORM** | 型安全な SQL クエリビルダー |
| **postgres.js** | Node.js から PostgreSQL へ接続するドライバ |
| **PostgreSQL** 17 | データベース |
| **tsx** | ビルドなしで TypeScript を直接実行 |

### アーキテクチャ

```
ブラウザ
  ↓
Hono (:3000)
  ├── GET  /           → 静的HTML（fetch APIでCRUD）
  ├── GET  /doc        → Swagger UI
  ├── GET  /openapi.json → OpenAPI 仕様（自動生成）
  └── /api/bookmarks/* → Drizzle ORM → PostgreSQL
```

Zodで書いたスキーマが、以下3つの役割を同時に果たすのがポイントです:

1. **リクエストバリデーション**: POSTボディの型チェック、URL形式チェック
2. **TypeScriptの型**: ハンドラ内で型推論が効く
3. **OpenAPI仕様**: Swagger UIに自動で反映される

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するためのCLIツールです。

### 主な機能

- **サーバー管理**: VPSの作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリをVPSにデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認
- **環境変数管理**: `app env set` でセキュアに環境変数を注入

`app deploy` コマンドは内部でDockerとDocker Composeを自動セットアップし、ディレクトリをgit push形式でVPSへ転送してコンテナを起動します。SSHキーさえ設定すれば、コマンド1本でデプロイが完了します。

---

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み（`conoha keypair create` で作成可能）

---

## ファイル構成

```
hono-drizzle-postgresql/
├── src/
│   ├── db/
│   │   ├── index.ts      # DB接続 + 初期化
│   │   └── schema.ts     # Drizzleスキーマ定義
│   ├── index.ts          # エントリポイント
│   └── routes.ts         # OpenAPIルート定義 + ハンドラ
├── public/
│   └── index.html        # 静的フロントエンド
├── compose.yml
├── Dockerfile
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

12ファイルとシンプルな構成です。`src/` 配下を見ればHono + Drizzle + OpenAPIの全体像が把握できます。

---

## Drizzleスキーマ: TypeScriptでテーブル定義

`src/db/schema.ts` にブックマークテーブルを定義します。

```typescript
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const bookmarks = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

PostgreSQL の配列型（`text[]`）もネイティブにサポートされており、`.array()` と書くだけです。この定義から `typeof bookmarks.$inferSelect` で SELECT 結果の型、`typeof bookmarks.$inferInsert` で INSERT の型が自動で導かれます。

DB接続と初期化は `src/db/index.ts` にまとめています。

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@db:5432/app";
const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export async function initDb() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      tags TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}
```

サンプルなのでマイグレーションは使わず起動時に `CREATE TABLE IF NOT EXISTS` しています。本番運用する場合は `drizzle-kit generate` でマイグレーションファイルを生成し、`migrate()` 関数で適用する流れに切り替えてください。

---

## OpenAPI ルート定義: Zodスキーマ1つで全部済む

`src/routes.ts` でルートとZodスキーマを定義します。`@hono/zod-openapi` の `createRoute` を使うと、ルートと OpenAPI メタデータが1か所に集約されます。

```typescript
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const BookmarkSchema = z
  .object({
    id: z.number().openapi({ example: 1 }),
    url: z.string().url().openapi({ example: "https://hono.dev" }),
    title: z.string().openapi({ example: "Hono - Web framework" }),
    description: z.string().nullable().openapi({ example: "Fast framework" }),
    tags: z.array(z.string()).openapi({ example: ["typescript", "web"] }),
    createdAt: z.string().openapi({ example: "2026-01-01T00:00:00.000Z" }),
    updatedAt: z.string().openapi({ example: "2026-01-01T00:00:00.000Z" }),
  })
  .openapi("Bookmark");

// http/https以外のURL（javascript:など）を弾く
const httpUrl = z.string().url().refine(
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

const CreateBookmarkSchema = z
  .object({
    url: httpUrl.openapi({ example: "https://hono.dev" }),
    title: z.string().min(1).max(200).openapi({ example: "Hono" }),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string().max(50)).max(20).optional().default([]),
  })
  .openapi("CreateBookmark");

const listRoute = createRoute({
  method: "get",
  path: "/api/bookmarks",
  tags: ["Bookmarks"],
  request: {
    query: z.object({
      tag: z.string().optional(),
      q: z.string().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
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
```

ハンドラ側では `c.req.valid("query")` で **型付けされた** クエリパラメータが取れます。Drizzleのクエリもすべて型推論が効きます。

```typescript
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
```

PostgreSQLの配列演算子 `@>`（contains）も `sql` テンプレートで自然に書けます。`ilike` は大文字小文字を区別しない LIKE で、`escapeLike()` で `%` や `_` をエスケープしているのでユーザー入力の `50%` などでも期待通り動きます。

---

## エントリポイント: Swagger UI マウント

`src/index.ts` でアプリを組み立てます。

```typescript
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { initDb } from "./db/index";
import { registerRoutes } from "./routes";

// バリデーションエラーを整形するデフォルトフック
const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          message: "Validation failed",
          errors: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400
      );
    }
  },
});

registerRoutes(app);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "Bookmark API", version: "1.0.0" },
});
app.get("/doc", swaggerUI({ url: "/openapi.json" }));
app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/", serveStatic({ path: "./public/index.html" }));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ message: "Internal server error" }, 500);
});

const port = 3000;
initDb()
  .then(() => {
    serve({ fetch: app.fetch, port }, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
```

たった数十行で以下が揃います:

- REST APIルート（`registerRoutes(app)`）
- OpenAPI仕様のエンドポイント（`/openapi.json`）
- Swagger UI（`/doc`）
- ヘルスチェック（`/health`）
- 静的フロントエンド（`/`）
- バリデーションエラーの整形
- グローバルエラーハンドラ

---

## compose.yml と Dockerfile

```yaml
services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://postgres:postgres@db:5432/app
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=app
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  db_data:
```

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
# tsx は dependencies に入れているので --omit=dev で OK
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
```

`tsx` をそのまま本番起動に使っているのがポイントです。TypeScriptのビルドステップが不要なので、Dockerfile がシングルステージで済み、開発と本番の差分も最小になります。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/hono-drizzle-postgresql
```

### 2. サーバー作成

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
```

### 3. アプリ初期化

```bash
conoha app init myserver --app-name hono-bookmark
```

```
Initializing app "hono-bookmark" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/hono-bookmark.git/
==> Installing post-receive hook...
==> Done!

App "hono-bookmark" initialized on vm-18268c66-ae (133.88.116.147).
```

### 4. デプロイ

```bash
conoha app deploy myserver --app-name hono-bookmark
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image postgres:17-alpine Pulling
 Image hono-bookmark-web Building
#8 [3/5] COPY package.json ./
#9 [4/5] RUN npm install --omit=dev
#9 53.8 added 28 packages in 53s
#10 [5/5] COPY . .
 Image hono-bookmark-web Built
 Container hono-bookmark-db-1 Started
 Container hono-bookmark-db-1 Healthy
 Container hono-bookmark-web-1 Started
NAME                  IMAGE                STATUS                   PORTS
hono-bookmark-db-1    postgres:17-alpine   Up (healthy)             5432/tcp
hono-bookmark-web-1   hono-bookmark-web    Up Less than a second    0.0.0.0:3000->3000/tcp
Deploy complete.
```

healthcheck で PostgreSQL が Ready になってから Hono が起動する順序制御が効いています。

---

## 動作確認

### ヘルスチェック

```bash
curl http://<サーバーIP>:3000/health
# {"status":"ok"}
```

### ブックマーク作成

```bash
curl -X POST http://<サーバーIP>:3000/api/bookmarks \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://hono.dev","title":"Hono","tags":["typescript","web"]}'
```

```json
{
  "id": 1,
  "url": "https://hono.dev",
  "title": "Hono",
  "description": null,
  "tags": ["typescript", "web"],
  "createdAt": "2026-04-09T06:15:19.267Z",
  "updatedAt": "2026-04-09T06:15:19.267Z"
}
```

### 一覧取得（タグフィルタ付き）

```bash
curl "http://<サーバーIP>:3000/api/bookmarks?tag=typescript"
```

```json
{
  "bookmarks": [
    { "id": 1, "url": "https://hono.dev", "title": "Hono", ... }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### Swagger UI

ブラウザで `http://<サーバーIP>:3000/doc` を開くと、Swagger UI が表示されます。Zodスキーマから自動生成された API 仕様がそのまま可視化され、「Try it out」でそのまま API を叩くこともできます。

### バリデーションエラー

```bash
curl -X POST http://<サーバーIP>:3000/api/bookmarks \
  -H 'Content-Type: application/json' \
  -d '{"url":"javascript:alert(1)","title":"evil"}'
```

```json
{
  "message": "Validation failed",
  "errors": [
    { "path": "url", "message": "URL must use http or https protocol" }
  ]
}
```

`javascript:` のような危険なURLは、Zodの `.refine()` によりAPI側で弾かれます。

### フロントエンド

`http://<サーバーIP>:3000` にアクセスすると、シンプルなブックマーク管理画面が開きます。`fetch` API でCRUDを呼び、タグクリックでフィルタ、検索、ページネーションが動作します。

---

## このサンプルの良いところ

TypeScript製のAPIサンプルとしては、かなり踏み込んだ内容になっています。

- **Zodスキーマから自動生成されるSwagger UI**: 「ドキュメントを書く」という作業そのものを消せる
- **Drizzleの型推論**: SQL文字列ではなくTypeScriptオブジェクトでクエリを書き、SELECT結果まで型付けされる
- **`tsx` による直接実行**: ビルドステップがゼロ、本番でもTypeScriptのまま動く
- **`postgres.js`**: `pg` よりモダンで、Promiseネイティブ、TLSサポートも組み込み
- **セキュリティ**: URLプロトコル検証、LIKE ワイルドカードエスケープ、フロント側の `escapeHtml()` と `rel="noopener noreferrer"`

---

## カスタマイズのヒント

### マイグレーションに切り替える

本番運用する場合は `drizzle-kit` によるマイグレーション管理に切り替えるのが安全です。

```bash
# schema.ts の変更から SQL マイグレーションを生成
npx drizzle-kit generate

# マイグレーションを DB に適用
npx drizzle-kit migrate
```

`src/db/index.ts` の `initDb()` を `drizzle-orm/postgres-js/migrator` の `migrate()` 関数に置き換えれば、起動時に未適用マイグレーションを自動で当てられます。

### エンドポイントを追加する

`src/routes.ts` に `createRoute` と `app.openapi(route, handler)` を1セット書き足すだけで、Swagger UI にも自動で反映されます。ルート追加とドキュメント更新が1か所で済むのは大きな開発体験の向上です。

---

## まとめ

conoha-cli の `app init` → `app deploy` の2コマンドで、Hono + Drizzle + PostgreSQL + Swagger UI の TypeScript 製 REST API を ConoHa VPS3 上に構築できました。

| アクセス先 | URL |
|---|---|
| フロントエンド | `http://<IP>:3000` |
| Swagger UI | `http://<IP>:3000/doc` |
| OpenAPI JSON | `http://<IP>:3000/openapi.json` |
| ヘルスチェック | `http://<IP>:3000/health` |

2026年に新しくTypeScript製のAPIを書くなら、Hono + Drizzle + Zod-OpenAPI の組み合わせは非常に有力な選択肢です。型安全性、開発体験、パフォーマンスのどれも妥協せずに済みます。

## 参考リンク

- サンプルコード: [crowdy/conoha-cli-app-samples/hono-drizzle-postgresql](https://github.com/crowdy/conoha-cli-app-samples/tree/main/hono-drizzle-postgresql)
- conoha-cli: [crowdy/conoha-cli](https://github.com/crowdy/conoha-cli)
- note.comでのconoha-cli紹介: [ConoHa VPSを便利に扱うCLIを作った話](https://note.com/kim_tonghyun/n/n77b464a61dc0?from=notice)
- [Hono 公式ドキュメント](https://hono.dev/)
- [Drizzle ORM 公式ドキュメント](https://orm.drizzle.team/)
- [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)

他にもWordPress、Strapi、Supabase、Outline、Quickwit + OpenTelemetryなど30種類以上のサンプルが揃っていますので、ぜひ試してみてください。

