# LINE API Mock

LINE Messaging API の OpenAPI 仕様に準拠したモックサーバー。LINE 公式アカウントを持たない開発者が、自分の LINE Bot を実 LINE に依存せず開発・テストできます。

## 特徴

- OpenAPI に準拠した `/v2/bot/*`, `/v2/oauth/*`, `/v3/token/*` エンドポイント
- **Webhook エミュレーション**: 管理 UI から仮想ユーザーが Bot に話しかけると、Bot の webhook に署名付きで POST
- 管理 UI (HTMX) でチャンネル・仮想ユーザー・会話・配信ログを管理
- Swagger UI (`/docs`) で API を試せる
- `@line/bot-sdk` が **そのまま接続できる** ことをテストで検証

## 構成

- Node.js 22 + TypeScript
- Hono + @hono/node-server
- Drizzle ORM + PostgreSQL 17
- ajv (OpenAPI スキーマ検証)
- HTMX + Tailwind CSS (管理 UI)

## 起動

```bash
cd line-api-mock
docker compose up --build
```

初回起動時、既定のチャンネルと仮想ユーザーが自動で作成され、コンテナログに認証情報が出力されます。

```
[line-api-mock] Seeded default channel:
  channel_id:     1234567890
  channel_secret: ...
  access_token:   ...
  webhook_url:    (not set — configure in /admin)
```

ブラウザで:

- 管理 UI: http://localhost:3000/admin
- Swagger UI: http://localhost:3000/docs
- ヘルスチェック: http://localhost:3000/health

## 使い方

1. 管理 UI の **Channels** で webhook URL を、自分の Bot が listen している URL に設定
2. **Users** で仮想ユーザーを作成(または既定の「テストユーザー」を利用)
3. **Conversations** で仮想ユーザーから Bot に発言
4. Bot が reply API を呼び返すと会話画面にリアルタイムで表示されます
5. `@line/bot-sdk` を使う場合は `baseURL` をこのモックサーバーに向けるだけ:
   ```ts
   new messagingApi.MessagingApiClient({
     channelAccessToken: "<上記のアクセストークン>",
     baseURL: "http://localhost:3000",
   });
   ```

## 環境変数

| 変数                          | 既定値                                    | 説明                                                                          |
|-------------------------------|-------------------------------------------|-------------------------------------------------------------------------------|
| `DATABASE_URL`                | `postgres://mock:mock@db:5432/mock`       | PostgreSQL 接続文字列                                                         |
| `PORT`                        | `3000`                                    | HTTP ポート                                                                   |
| `APP_BASE_URL`                | `http://localhost:3000`                   | 自己参照 URL                                                                  |
| `ADMIN_USER`                  | `admin`                                   | 管理 UI Basic Auth ユーザー                                                   |
| `ADMIN_PASSWORD`              | (自動生成)                                | 管理 UI Basic Auth パスワード                                                 |
| `TOKEN_TTL_SEC`               | `2592000`                                 | 発行トークン有効期限(秒、既定 30 日)                                        |
| `MOCK_ALLOW_PRIVATE_WEBHOOKS` | `0`                                       | `1` にするとプライベート/ループバック IP への webhook 送信を許可（ローカル開発用）|

> **注意**: `ADMIN_USER` / `ADMIN_PASSWORD` を設定しない場合、起動時に自動でランダムパスワードが生成されコンテナログに出力されます。
> `MOCK_ALLOW_PRIVATE_WEBHOOKS` は既定で無効 (`0`)。ローカルで自分の Bot (127.0.0.1 など) に webhook を飛ばす時は `MOCK_ALLOW_PRIVATE_WEBHOOKS=1 docker compose up` で起動してください。本番・公開 VPS では `0` のまま運用してください。

## ConoHa VPS にデプロイ

```bash
# 1. サーバー作成（既存があればスキップ）
conoha server create --name line-mock --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える
#    DNS A レコードがサーバー IP を指している必要があります

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com line-mock

# 4. アプリ登録
cd line-api-mock
conoha app init line-mock

# 5. 環境変数を設定（APP_BASE_URL は公開 FQDN を指定 — 本体が生成する
#    webhook コールバック URL や自己参照 URL に使われるため、未設定だと
#    モック内部の URL が http://localhost:3000 のままになり外部から届きません）
conoha app env set line-mock APP_BASE_URL=https://<あなたの FQDN>

# 6. デプロイ
conoha app deploy line-mock

# シードされた認証情報を確認
conoha app logs line-mock
```

`db` は accessory として宣言されているため、blue/green 切替時も PostgreSQL は再起動されません。
管理 UI は `https://<あなたの FQDN>/admin` で利用できます。

## テスト

```bash
npm run test:unit          # 純粋関数の単体テスト
npm run test:integration   # Docker で Postgres を立てて統合テスト
npm run test:sdk           # @line/bot-sdk との互換性
npm run test:e2e           # Playwright + Docker Compose
```

## 対応エンドポイント

### 実装済み

- Channel Access Token (v2 / v3)
- Push / Reply / Multicast / Broadcast / Narrowcast
- Message quota / consumption
- Profile
- Webhook endpoint 設定 / テスト送信
- メッセージコンテンツ取得
- Coupon (作成 / 一覧 / 詳細 / close、`type:"coupon"` メッセージ)
- Message validate (reply / push / multicast / narrowcast / broadcast)
- Bot info / Followers IDs
- Rich menu (作成 / 検証 / 取得 / 一覧 / 削除 / 画像 / ユーザー link / default / bulk / alias CRUD / batch + validate + progress)

### 未実装 (呼ぶと 501 を返す)

- LIFF / Insight / Audience / MLS / Shop / module-attach

Swagger UI には表示されますが、実装は v2 以降の予定です。

## 仕様のソース

`specs/messaging-api.yml` は [line/line-openapi](https://github.com/line/line-openapi) から取得した vendored ファイルです。取得元とコミット SHA は `specs/README.md` に記録しています。

## セキュリティ

- **管理 UI 認証**: 常に Basic Auth が有効です。`ADMIN_USER`/`ADMIN_PASSWORD` が未設定の場合、起動時にランダムパスワードが自動生成され、コンテナログに出力されます。
- **Webhook URL 制限**: デフォルトでプライベート IP・ループバック・リンクローカルアドレスへの送信を拒否します（SSRF 対策）。`MOCK_ALLOW_PRIVATE_WEBHOOKS=1` で解除できます（ローカル開発用途のみ）。
- **既知の制限**: CSRF 保護なし、レート制限なし。インターネット公開環境での使用は想定していません。

## このサンプルが *含まない* もの

- 実 LINE Platform との完全互換(形式のみ準拠、内部挙動は簡略化)
- JWT assertion の署名検証
- レート制限・クォータ強制
- マルチテナント的な権限分離
- HTTPS 終端(必要なら `nginx-reverse-proxy` サンプルと組み合わせる)
