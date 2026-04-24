# supabase-selfhost

Firebase 代替のオープンソース BaaS（Backend as a Service）。認証、データベース、REST API、管理 UI をセルフホストで利用できます。

## 構成

- [Supabase](https://supabase.com/) — BaaS プラットフォーム
  - Kong — API ゲートウェイ（**proxy 公開**、クライアント SDK が叩く対象）
  - Studio — 管理 UI（accessory、内部専用）
  - GoTrue — 認証サービス（accessory）
  - PostgREST — REST API 自動生成（accessory）
  - PostgreSQL 15 — データベース（accessory）
- proxy 公開ポート: 8000（Kong）
- 内部のみ: 3000（Studio）、5432（PostgreSQL）、auth / meta / rest

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — compose のデフォルトは
#    公開リポジトリに記載されています）
conoha app env set myserver \
  POSTGRES_PASSWORD=$(openssl rand -base64 32) \
  JWT_SECRET=$(openssl rand -base64 48) \
  API_EXTERNAL_URL=https://supabase-selfhost.example.com \
  SITE_URL=https://supabase-selfhost.example.com

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

1. **クライアント SDK から接続**（主なユースケース）:
   ```js
   import { createClient } from '@supabase/supabase-js'
   const supabase = createClient(
     'https://<あなたの FQDN>',
     '<ANON_KEY — JWT_SECRET から生成>'
   )
   ```
2. **REST API 直接**: `curl https://<FQDN>/rest/v1/<table>` （`apikey` ヘッダー必須）

## ⚠ 既知の制限: Studio 管理 UI は内部専用

Supabase Studio（:3000）は **proxy 経由では公開されません**（proxy は FQDN につき 1 サービスしかフロントできず、クライアント SDK が叩く Kong を優先した）。Table Editor や SQL Editor を使うには次のいずれかを選んでください:

1. **ホスト済み Studio を使う**: [supabase.com/dashboard](https://supabase.com/dashboard) にログインして、セルフホスト Supabase のエンドポイント (`https://<FQDN>`) と service key を設定
2. **Studio を別 conoha.yml プロジェクトに切り出す**（`admin.example.com` サブドメイン）: future batch で対応予定
3. **docker exec 経由**:
   ```bash
   ssh root@<サーバー IP>
   docker exec $(docker ps -q -f name=studio) wget -qO- http://localhost:3000
   ```

## ANON_KEY / SERVICE_ROLE_KEY について

上記の step 5 では `JWT_SECRET` だけ設定しています。`ANON_KEY` と `SERVICE_ROLE_KEY` はその JWT_SECRET を元に生成する必要があります — 手順は公式ドキュメント参照: https://supabase.com/docs/guides/self-hosting#api-keys

## カスタマイズ

- Next.js や SvelteKit から `@supabase/supabase-js` で接続可能
- Studio の SQL Editor でマイグレーションやファンクション作成
- 本番環境では JWT シークレットと API キーを必ず再生成してください
- ANON_KEY / SERVICE_ROLE_KEY は JWT_SECRET を元に https://supabase.com/docs/guides/self-hosting#api-keys で生成
