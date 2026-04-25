# supabase-selfhost

Firebase 代替のオープンソース BaaS（Backend as a Service）。認証、データベース、REST API、管理 UI（Studio）をセルフホストで利用できます。

> **conoha-cli >= v0.6.1 が必要です** — それ以前のバージョンは `expose:` ブロックの `blue_green: false` を黙って無視し、admin サブドメインへのルーティングが 404 になります（参照: conoha-cli#163）。

## 構成

- [Supabase](https://supabase.com/) — BaaS プラットフォーム
  - **Kong** — API ゲートウェイ（root FQDN 公開、クライアント SDK が叩く対象）
  - **Studio** — 管理 UI（admin サブドメイン公開）
  - GoTrue — 認証サービス（accessory）
  - PostgREST — REST API 自動生成（accessory）
  - postgres-meta — Studio 用 Postgres メタデータ API（accessory）
  - PostgreSQL 15 — データベース（accessory）

```
                                  ┌── https://supabase-selfhost.example.com  → Kong (8000)
                                  │     ├── /auth/v1/*    → GoTrue (auth:9999)
proxy (ACME, blue/green) ─────────┤     ├── /rest/v1/*    → PostgREST (rest:3000)
                                  │     └── /pg/*         → postgres-meta (meta:8080)
                                  │
                                  └── https://admin.example.com               → Studio (3000)
                                              （Table Editor / SQL Editor）
```

## 前提条件

- conoha-cli **>= v0.6.1** がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開する 2 つの FQDN の DNS A レコードがサーバー IP を指している:
  - `supabase-selfhost.example.com`（Kong = クライアント SDK / REST / Auth）
  - `admin.example.com`（Studio 管理 UI）

## デプロイ

```bash
# 1. サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` と `expose[].host` を自分の FQDN に書き換える
#    - hosts[0]: supabase-selfhost.example.com  → Kong（クライアント SDK 用）
#    - expose[label=admin].host: admin.example.com → Studio
#    両方とも先に DNS A レコードを設定すること。

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — compose のデフォルトは
#    公開リポジトリに記載されているため本番では必ず再生成してください）
conoha app env set myserver \
  POSTGRES_PASSWORD=$(openssl rand -base64 32) \
  JWT_SECRET=$(openssl rand -base64 48) \
  ANON_KEY=<JWT_SECRET から生成した anon ロールの JWT> \
  SERVICE_ROLE_KEY=<JWT_SECRET から生成した service_role ロールの JWT> \
  API_EXTERNAL_URL=https://supabase-selfhost.example.com \
  GOTRUE_SITE_URL=https://supabase-selfhost.example.com \
  SUPABASE_PUBLIC_URL=https://supabase-selfhost.example.com

# 6. デプロイ
conoha app deploy myserver
```

`ANON_KEY` / `SERVICE_ROLE_KEY` の生成は公式手順を参照してください: https://supabase.com/docs/guides/self-hosting#api-keys

## 動作確認

1. **クライアント SDK / REST API**（root FQDN）:
   ```js
   import { createClient } from '@supabase/supabase-js'
   const supabase = createClient(
     'https://supabase-selfhost.example.com',
     '<ANON_KEY>'
   )
   ```
   ```bash
   curl -H "apikey: <ANON_KEY>" https://supabase-selfhost.example.com/rest/v1/<table>
   ```

2. **Studio 管理 UI**: ブラウザで `https://admin.example.com` を開く。Table Editor / SQL Editor / Auth users / Database 設定が利用できます。

## ⚠ admin サブドメインのアクセス制御について

**`https://admin.example.com` に到達できる相手は誰でも Studio の管理 UI を操作できます**（Studio 自体には認証が無く、内部の `SERVICE_ROLE_KEY` でフルアクセスする前提）。本番運用では proxy 層で必ず追加の保護をかけてください:

- IP 許可リスト（オフィス IP / VPN のみ）
- proxy 側の Basic 認証
- VPN / SSH トンネル経由のみで公開

このサンプルでは proxy のアクセス制御まで踏み込みません — フォローアップ作業として対応予定です。応急策として、admin サブドメインの DNS を一時的に消すと外部到達を遮断できます（root FQDN 側のクライアント SDK / REST 経路は影響を受けません）。

## 公開しないもの

以下の accessory は意図的に proxy 公開していません — root / admin の 2 FQDN 以外に経路はありません:

- **`db:5432`** (PostgreSQL): 公開すると Postgres ロール認証だけが防衛線になり危険。psql が必要なら `ssh root@<vps>` 後に `docker exec -it $(docker ps -q -f name=db) psql -U postgres`。
- **`auth:9999`** (GoTrue 直接), **`rest:3000`** (PostgREST 直接), **`meta:8080`** (postgres-meta): いずれも Kong (root FQDN) 経由で `/auth/v1/*` / `/rest/v1/*` / `/pg/*` として公開されており、直接公開する必要はありません。

## カスタマイズ

- Next.js / SvelteKit / Flutter から `@supabase/supabase-js` で接続可能
- Studio の SQL Editor でマイグレーションやファンクション作成
- 本番環境では `JWT_SECRET` / `POSTGRES_PASSWORD` / `ANON_KEY` / `SERVICE_ROLE_KEY` を必ず再生成してください

## 既知の注意点

- `ANON_KEY` / `SERVICE_ROLE_KEY` を生成する際、`JWT_SECRET` が一致していないと Kong 経由の `/rest/v1/*` リクエストが 401 になります。順序: 先に `JWT_SECRET` を決め、それを使って 2 つの JWT を発行 → `app env set` で 3 つまとめて投入 → `app deploy`。
