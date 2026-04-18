---
title: conoha-cliでLINE Messaging APIモックサーバー(@line/bot-sdk互換・webhookエミュレーション付き)をConoHa VPSにデプロイしてみた
tags: ConoHa conoha-cli LINE Hono TypeScript
author: crowdy
slide: false
---
## はじめに

LINE Bot を作ってみたいけれど、公式アカウントの発行がまだ通らず手元で試せない。LINE Developers に登録してはみたものの、審査待ちや事業要件確認で時間がかかる。個人開発で「お試し」をしたいだけなのに、そもそもスタートラインに立てない——そんなことはありませんか？

私もまさにその状況で、「LINE Messaging API の仕様どおりに振る舞うが、実際にはメッセージを送らないモックサーバーが欲しい」と考えました。`@line/bot-sdk` でコードを書きながら動作確認をしたいのですが、肝心のチャネルがない。モックサーバー自体は OSS にもいくつかありますが、「公式 SDK がそのまま接続できる」「webhook も署名付きで飛ばせる」「管理 UI から仮想ユーザーが Bot に話しかけられる」——ここまでやってくれるものは見当たりませんでした。

そこで、[line/line-openapi](https://github.com/line/line-openapi) が公開している OpenAPI 仕様をベースに、**LINE Messaging API のモックサーバー** を自前で実装しました。公式 `@line/bot-sdk` (Node.js 版) を `baseURL` だけ差し替えてそのまま接続できることを CI テストで検証しています。

この記事では、構成の解説、公式 SDK を使った互換性テスト、そして [conoha-cli](https://github.com/crowdy/conoha-cli) で ConoHa VPS3 にデプロイするまでの手順を紹介します。実際にデプロイして踏んだ **4 つのハマりポイント** も共有します。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Node.js 22** | ランタイム |
| **TypeScript** | 言語 |
| **Hono** v4 | Web フレームワーク(軽量・高速・TypeScript ネイティブ) |
| **Drizzle ORM** | 型安全な SQL クエリビルダー |
| **PostgreSQL** 17 | データベース |
| **ajv** | OpenAPI スキーマ検証 |
| **HTMX + Tailwind CSS** | 管理 UI(ビルド不要、CDN 読み込み) |
| **Vitest + testcontainers-node** | 単体・統合テスト |
| **@line/bot-sdk** | 公式 SDK を使った互換性テスト |
| **Playwright** | E2E テスト(webhook 往復検証) |

### アーキテクチャ

```
[Browser / Bot]
      │
      ▼ :3000
┌────────────────────────────────────┐
│  Hono app                          │
│   ├─ /v2/*, /v3/*   (LINE mock)    │
│   ├─ /admin/*        (HTMX UI)     │
│   ├─ /admin/events   (SSE)         │
│   ├─ /docs           (Swagger UI)  │
│   └─ /openapi.yaml   (vendored)    │
│        │                           │
│        └─ webhook dispatcher       │
│             │ X-Line-Signature 付与│
│             ▼                      │
│       [開発者 Bot の webhook URL]  │
└────────────────────────────────────┘
      │
      ▼ :5432
┌────────────────────────────────────┐
│  PostgreSQL 17                     │
│   channels / access_tokens /       │
│   virtual_users / messages /       │
│   webhook_deliveries / api_logs    │
└────────────────────────────────────┘
```

差別化ポイントは **Webhook エミュレーション** です。管理 UI から仮想ユーザーが Bot 宛に発言すると、モックが LINE Platform と同じ形式の webhook イベントを生成し、Channel Secret で HMAC-SHA256 署名を付けて開発者の Bot URL に POST します。Bot が reply API を呼び返せばモックに保存され、管理 UI の会話画面に SSE 経由でリアルタイムに反映されます。つまり公式アカウントなしでも **双方向の開発ループが完結** します。

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するための CLI ツールです。

### 主な機能

- **サーバー管理**: VPS の作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリを VPS にデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認

`app deploy` コマンドは内部で Docker と Docker Compose を自動セットアップし、ディレクトリを git push 形式で VPS へ転送してコンテナを起動します。SSH キーさえ設定すれば、コマンド 1 本でデプロイが完了します。

---

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み(`conoha keypair create` で作成可能)

---

## ファイル構成

```
line-api-mock/
├── compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── specs/
│   ├── README.md           # 取得元の SHA 記録
│   └── messaging-api.yml   # line-openapi から vendored
├── src/
│   ├── index.ts            # Hono エントリ
│   ├── config.ts           # 型付き環境変数
│   ├── db/                 # Drizzle スキーマ・マイグレーション・シード
│   ├── lib/                # ID 生成・エラー・EventEmitter
│   ├── mock/               # LINE API 各エンドポイント
│   │   ├── oauth.ts
│   │   ├── oauth-v3.ts
│   │   ├── message.ts
│   │   ├── profile.ts
│   │   ├── quota.ts
│   │   ├── content.ts
│   │   ├── webhook-endpoint.ts
│   │   ├── not-implemented.ts
│   │   └── middleware/     # auth / request-log / validate
│   ├── webhook/
│   │   ├── signature.ts    # HMAC-SHA256
│   │   ├── dispatcher.ts
│   │   └── url-policy.ts   # SSRF 対策
│   └── admin/              # 管理 UI (JSX + HTMX)
└── test/
    ├── unit/
    ├── integration/        # testcontainers-node で Postgres 起動
    ├── sdk-compat/         # @line/bot-sdk を使った互換性テスト
    └── e2e/                # Playwright (webhook 往復)
```

---

## 実装のポイント

### 1. vendored OpenAPI 仕様 + ajv による実行時検証

LINE 公式が公開する [line/line-openapi](https://github.com/line/line-openapi) の YAML を `specs/messaging-api.yml` に vendoring し、取得元コミットの SHA を `specs/README.md` に記録しています。型は `openapi-typescript` でコミット対象として生成、実行時スキーマ検証は `ajv` を使っています。

ハンドラに `validate()` ミドルウェアを挟むだけで、リクエスト・レスポンス両方を OpenAPI スキーマに照らせます(ただし現状はデモとして push 1 エンドポイントのみ配線、拡大は今後の課題)。

```typescript
messageRouter.post(
  "/v2/bot/message/push",
  validate({
    requestSchema: "#/components/schemas/PushMessageRequest",
    responseSchema: "#/components/schemas/PushMessageResponse",
  }),
  async (c) => { /* ハンドラ本体 */ }
);
```

### 2. Webhook 署名(HMAC-SHA256)

LINE Platform が送る webhook と全く同じ形式で `X-Line-Signature` ヘッダを付けます。Channel Secret を使った HMAC-SHA256 の base64 です。

```typescript
// src/webhook/signature.ts
import { createHmac } from "node:crypto";

export function signBody(channelSecret: string, body: string): string {
  return createHmac("sha256", channelSecret).update(body).digest("base64");
}
```

この 5 行が本モックの差別化機能の核です。公式 `@line/bot-sdk` の `validateSignature(body, secret, signature)` が `true` を返すことを単体テストで検証しています。

### 3. Webhook ディスパッチャ

管理 UI で仮想ユーザーが発言すると、モックが LINE の webhook event 形式 JSON を構築し、上記の署名を付けて開発者の Bot URL に POST します。応答は `webhook_deliveries` テーブルにフル記録されるので、管理 UI の Webhook Log 画面で配信結果・失敗理由・レスポンス本文を確認できます。

```typescript
// src/webhook/dispatcher.ts (抜粋)
const body = JSON.stringify(event);
const signature = signBody(ch.channelSecret, body);
const res = await fetch(ch.webhookUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-line-signature": signature,
    "user-agent": "LineBotWebhook/2.0",
  },
  body,
  signal: AbortSignal.timeout(10_000),
});
// ... webhook_deliveries に記録、SSE でも通知
```

### 4. 管理 UI は Hono JSX + HTMX + Tailwind CDN

Vite も Webpack も使わず、Hono JSX で SSR、クライアントは HTMX + Tailwind を CDN から読み込むだけ。ビルドステップなしで管理画面が動きます。会話画面は SSE(`/admin/events`)を介して Bot の返信が即座に反映されます。

---

## @line/bot-sdk を使った互換性テスト

**この仕組みを作った一番の動機** は、公式 SDK が修正なしで動作することを実証するためです。`test/sdk-compat/` ディレクトリに以下のテストを配置しました。

```typescript
// test/sdk-compat/messaging.test.ts (抜粋)
import { messagingApi } from "@line/bot-sdk";

function sdkClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: token,
    baseURL: `http://127.0.0.1:${port}`, // ←ここをモックに向けるだけ
  });
}

describe("@line/bot-sdk MessagingApiClient against mock", () => {
  it("pushMessage succeeds", async () => {
    const client = sdkClient();
    const res = await client.pushMessage({
      to: botUserId,
      messages: [{ type: "text", text: "hi from sdk" }],
    });
    expect(Array.isArray(res.sentMessages)).toBe(true);
    expect(res.sentMessages!.length).toBe(1);
  });

  it("getProfile returns a known user", async () => {
    const client = sdkClient();
    const p = await client.getProfile(botUserId);
    expect(p.userId).toBe(botUserId);
    expect(p.displayName).toBe("SDK Tester");
  });
  // ... multicast / broadcast も同様
});
```

Webhook の署名も同じく公式 SDK で検証します。

```typescript
// test/sdk-compat/webhook-signature.test.ts
import { validateSignature } from "@line/bot-sdk";
import { signBody } from "../../src/webhook/signature.js";

it("validateSignature(body, secret, signature) === true", () => {
  const secret = "s3cret-for-testing";
  const body = JSON.stringify({ destination: "U0", events: [/*...*/] });
  const signature = signBody(secret, body);
  expect(validateSignature(body, secret, signature)).toBe(true);
});
```

公式 SDK が自作モックに対して正常動作するということは、**レスポンスの JSON 形状・必須フィールド・エラー形式が LINE の仕様に準拠している**ことの最も強い証明になります。自前で `ajv` による応答検証を書くより、実際に開発者が使うライブラリを通すのが最も確実です。

---

## compose.yml と Dockerfile

```yaml
# compose.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://mock:mock@db:5432/mock
      - APP_BASE_URL=http://localhost:3000
      - PORT=3000
      - MOCK_ALLOW_PRIVATE_WEBHOOKS=${MOCK_ALLOW_PRIVATE_WEBHOOKS:-0}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      - POSTGRES_USER=mock
      - POSTGRES_PASSWORD=mock
      - POSTGRES_DB=mock
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mock"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  db_data:
```

```dockerfile
# Dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
```

`tsx` で TypeScript を直接実行するのでビルドステップはありません。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/line-api-mock
```

### 2. サーバー作成

ConoHa では Docker が事前インストールされた `vmi-docker-29.2-ubuntu-24.04-amd64` イメージがあり、初期設定の手間が省けます。

```bash
conoha server create --name line-api-mock \
  --flavor 784f1ae8-0bc8-4d06-a06b-2afaa9580e0a \
  --image 722c231f-3f61-4e79-a5a6-c70d6c9ea908 \
  --key-name tkim-cli-test-key \
  --security-group IPv4v6-SSH \
  --security-group 3000-9999 \
  --wait -y
```

| フラグ | 値 | 意味 |
|---|---|---|
| `--flavor` | `g2l-t-c3m2` (3 vCPU, 2GB RAM) | 2GB メモリのスタンダード |
| `--image` | `vmi-docker-29.2-ubuntu-24.04-amd64` | Docker 同梱の Ubuntu |
| `--security-group IPv4v6-SSH` | SSH (22) を許可 | |
| `--security-group 3000-9999` | 3000 番(アプリ)を許可 | |

### 3. アプリ初期化

```bash
conoha app init line-api-mock --app-name line-api-mock \
  -i ~/.ssh/conoha_tkim-cli-test-key
```

```
Initializing app "line-api-mock" on vm-cff4bd79-d4 (160.251.184.240)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/line-api-mock.git/
==> Installing post-receive hook...
==> Done!
```

### 4. デプロイ

```bash
conoha app deploy line-api-mock --app-name line-api-mock \
  -i ~/.ssh/conoha_tkim-cli-test-key
```

docker build が走り、`line-api-mock-app-1` と `line-api-mock-db-1` が立ち上がります。

```
Container line-api-mock-db-1 Healthy
Container line-api-mock-app-1 Started
NAME                  IMAGE                STATUS                   PORTS
line-api-mock-app-1   line-api-mock-app    Up Less than a second    0.0.0.0:3000->3000/tcp
line-api-mock-db-1    postgres:17-alpine   Up 6 seconds (healthy)   5432/tcp
Deploy complete.
```

### 5. シード情報の取得

初回起動時にデフォルトのチャネル・仮想ユーザー・管理 UI パスワードが自動生成され、コンテナログに出力されます。

```bash
conoha app logs line-api-mock --app-name line-api-mock \
  -i ~/.ssh/conoha_tkim-cli-test-key | grep -E "admin_|channel_|access_token"
```

```
app-1  |   admin_user:     admin
app-1  |   admin_password: 038a7083e97f39ab09ceb57b
app-1  |   channel_id:     9875215823
app-1  |   channel_secret: 3f2077426350d19ff96946b939df5568
app-1  |   access_token:   9bb59346c4991d9f2841c5f818a439e20e109f35b367cf56
```

---

## 動作確認

VM の IP を `160.251.184.240` とします。

### ヘルスチェック

```bash
curl http://160.251.184.240:3000/health
# {"status":"ok"}
```

### 管理 UI

ブラウザで `http://160.251.184.240:3000/admin` を開くと Basic 認証ダイアログが出ます。ログ出力の `admin / <password>` で入る と、ダッシュボード・チャネル一覧・仮想ユーザー一覧・会話 UI・webhook ログが操作できます。

### Swagger UI

`http://160.251.184.240:3000/docs` で vendored OpenAPI を Swagger UI から閲覧・試行できます。

### @line/bot-sdk からの接続

VM 上のモックに対して、手元のマシンから公式 SDK で接続できます。

```typescript
import { messagingApi } from "@line/bot-sdk";

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: "9bb59346c4991d9f2841c5f818a439e20e109f35b367cf56",
  baseURL: "http://160.251.184.240:3000",
});

await client.pushMessage({
  to: "Ufb864fd820f62456f3559977bacd77b4", // ログに出たシードユーザー
  messages: [{ type: "text", text: "hello from sdk" }],
});
// { sentMessages: [{ id: "485653616123594294" }] }
```

メッセージは管理 UI の会話画面に即座に反映されます。

---

## ハマりポイント

デプロイ・テスト過程で踏んだ 4 つのポイントを共有します。

### 1. Hono の `use("*")` が全ルートを飲み込む

**症状**: Playwright の E2E テストで、`/admin/channels` や `/admin/users` は普通に開けるのに、**公開するはずの `/health` や `/openapi.yaml` まで 401 Unauthorized** を返してしまう。

**原因**: Hono のルーターで `adminRouter.use("*", adminAuth)` と書いて `app.route("/", adminRouter)` でマウントしていました。`"*"` は「この router 配下の全パス」にマッチするのですが、**router をルートに mount しているので結果的に全リクエストに Basic 認証が走っていた** わけです。

それだけではなく、別の事情もありました。mock API 側の `messageRouter.use("*", bearerAuth)` も同じ問題を抱えていて、**bearer 認証を必要としない `/health` や `/admin` にまで Bearer トークン検証が走っていた**。

**解決策**: 全ルーターで `use` の path prefix を明示的に限定する。

```typescript
// BEFORE
adminRouter.use("*", adminAuth);
messageRouter.use("*", bearerAuth);

// AFTER
adminRouter.use("/admin", adminAuth);
adminRouter.use("/admin/*", adminAuth);
messageRouter.use("/v2/*", requestLog);
messageRouter.use("/v2/*", bearerAuth);
```

**教訓**: ミドルウェアの scope は「router 内の相対パス」ではなく「最終的にアプリ全体で評価されるパス」で考える。Hono ドキュメントを読み返したら実は注意書きがあるのですが、コードレビューで指摘されるまで気づきませんでした。

### 2. `compose.yml` の SSRF ガードが本番で無効化されていた

**症状**: デプロイ後、`POST /v2/bot/channel/webhook/test` に `{"endpoint":"http://169.254.169.254/latest/meta-data/"}` を投げたら **応答せずタイムアウト**。

**原因**: モックは SSRF 対策として `checkWebhookUrl()` で RFC1918 / ループバック / クラウドメタデータをデフォルトで拒否する実装を持っています。ただし開発時に localhost の Bot にも webhook を飛ばしたいので、環境変数 `MOCK_ALLOW_PRIVATE_WEBHOOKS=1` で緩められるようにしてありました。

問題は、この **開発用の緩和設定を `compose.yml` にハードコードしていた** こと。`docker compose up` で起動した瞬間から SSRF ガードが常時 OFF、つまり ConoHa VPS にデプロイした時点でメタデータサーバー (169.254.169.254) に到達できてしまう状態になっていました。

**解決策**: `compose.yml` を環境変数参照に変え、デフォルトは安全側(`0`)。

```yaml
# BEFORE
environment:
  - MOCK_ALLOW_PRIVATE_WEBHOOKS=1

# AFTER
environment:
  - MOCK_ALLOW_PRIVATE_WEBHOOKS=${MOCK_ALLOW_PRIVATE_WEBHOOKS:-0}
```

Playwright の E2E では `playwright.config.ts` の `webServer.env` で明示的に `1` をセットし、通常の `docker compose up` ではガードが有効なままになるようにしました。

**教訓**: 「ローカル開発の便利設定」をそのまま本番デフォルトにしない。開発環境のオプションは明示的にオプトインさせる。レビューで指摘されなければ、実機にデプロイして初めて気づくクラスの問題でした。

### 3. 管理 UI のランダムパスワードが再起動のたびに変わる

**症状**: `conoha app deploy` で再デプロイするたびに、管理 UI の Basic 認証がそれまでのパスワードを受け付けなくなる。

**原因**: セキュリティ対策として、`ADMIN_USER` / `ADMIN_PASSWORD` 環境変数が両方空のときは起動時にランダム 24 文字 hex を自動生成してログに出力する、という設計にしました。これ自体はデフォルト公開配布の安全性を上げる良い設計ですが、**コンテナ再起動のたびに生成し直されるため、コンテナ再起動 ⇒ 旧パスワード失効 ⇒ 毎回ログを見に行く**という運用が発生します。

```
[line-api-mock] Admin auth (generated — set ADMIN_USER/ADMIN_PASSWORD env vars to override):
  admin_user:     admin
  admin_password: 038a7083e97f39ab09ceb57b   ← 再起動で別物に
```

**解決策 (暫定)**: README に「長期運用するなら `ADMIN_USER` / `ADMIN_PASSWORD` を明示セット」と記載し、conoha の `app env set` や `.env.server` で投入する運用を案内。

**根本解決 (TODO)**: 生成したパスワードを DB (あるいはマウントされた一時ファイル) に永続化する。デフォルト公開安全性は維持しつつ、2 回目以降の起動でも同じパスワードが使えるようにすべき。follow-up issue として登録済みです。

**教訓**: セキュアデフォルトと運用の継続性はトレードオフになりがち。自動生成する場合は「初回だけ生成して保存」と「毎回生成」のどちらがこのサンプルで妥当か、設計時点でハッキリさせるべきでした。

### 4. `testcontainers-node` の PostgreSqlContainer は別パッケージに

**症状**: 統合テストを書き始めたら `testcontainers` パッケージに `PostgreSqlContainer` が存在せずビルドエラー。

```typescript
// 最初こう書いた
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "testcontainers";
// TS2305: Module has no exported member 'PostgreSqlContainer'
```

**原因**: testcontainers-node は v10 以降、各種 DB モジュールが **サブパッケージ化** されました。PostgreSQL は `@testcontainers/postgresql` に分離されています。古い記事やチュートリアルでは `testcontainers` 一発で済むように書いてあることが多いので、鵜呑みにすると詰まります。

**解決策**:

```bash
npm install --save-dev @testcontainers/postgresql
```

```typescript
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
```

**教訓**: testcontainers-node に限らず、大きなツールキットはバージョンアップでサブパッケージに分解されがち。ドキュメントとリリースノートを一次情報として当たる。

---

## おまけ: JSX を使う routes は `.tsx` 必須

`src/admin/routes.ts` で `<Dashboard />` と書いたら TypeScript の `tsc` が死にました。当たり前といえば当たり前ですが、**JSX を含むファイルは拡張子が `.tsx` でなければなりません**。`routes.tsx` にリネームし、import 側は Node ESM 規約により拡張子を `.js` のまま保ってコンパイル・ランタイム両方でリゾルブするようにしています。

```typescript
// tsconfig.json の該当箇所
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  }
}
```

---

## まとめ

| 項目 | 内容 |
|---|---|
| デプロイ対象 | LINE Messaging API モックサーバー |
| 構成 | Hono + Drizzle + PostgreSQL の 2 コンテナ |
| 公式 SDK 互換 | `@line/bot-sdk` の `baseURL` 差し替えだけで動作 |
| Webhook エミュレーション | 管理 UI から仮想ユーザー発言 → 署名付き POST |
| 推奨フレーバー | `g2l-t-c3m2`(3 vCPU, 2GB RAM) |
| 推奨イメージ | `vmi-docker-29.2-ubuntu-24.04-amd64` |
| サンプル | [crowdy/conoha-cli-app-samples/line-api-mock](https://github.com/crowdy/conoha-cli-app-samples/tree/main/line-api-mock) |

- LINE 公式アカウントがまだない段階でも、Bot 実装を先行してテストできるモックサーバーを `conoha app deploy` ひとつで立ち上げられます
- `@line/bot-sdk` がそのまま動くので、「モック用にコードを書き換える」必要がありません。将来本番の LINE Platform に切り替えるときは `baseURL` を消すだけです
- Webhook の HMAC 署名も公式 SDK の `validateSignature` で検証できるレベルで準拠しています
- デプロイ中に見つけた Hono ミドルウェアのスコープ問題、compose.yml の SSRF ガード消失、管理 UI パスワードの揮発、testcontainers のサブパッケージ化、という 4 つのハマりポイントを共有しました。最後の 1 つ以外はコードレビューで拾いきれず、実機に載せてから気づいたものです。モノを書いたら必ず一度は実環境に置いてみる、という古典的な教訓をあらためて実感しました

次に「外部 API に依存する何か」のモックを作るときは、公式 SDK で通ることを CI で担保するこのアプローチをぜひお試しください。仕様書だけ読んで作ると絶対どこかで取りこぼします。

---

## 参考

- サンプルコード: [crowdy/conoha-cli-app-samples/line-api-mock](https://github.com/crowdy/conoha-cli-app-samples/tree/main/line-api-mock)
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築(note.com)](https://note.com/kim_tonghyun/n/n77b464a61dc0)
- [line/line-openapi](https://github.com/line/line-openapi) — LINE 公式の OpenAPI 仕様
- [line/line-bot-sdk-nodejs](https://github.com/line/line-bot-sdk-nodejs) — 公式 SDK
- [LINE Developers — Messaging API リファレンス](https://developers.line.biz/ja/reference/messaging-api/)
- [Hono 公式ドキュメント](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [testcontainers-node](https://node.testcontainers.org/)
