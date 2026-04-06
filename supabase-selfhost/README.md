# supabase-selfhost

Firebase 代替のオープンソース BaaS（Backend as a Service）。認証、データベース、REST API、管理 UI をセルフホストで利用できます。

## 構成

- [Supabase](https://supabase.com/) — BaaS プラットフォーム
  - Studio — 管理 UI
  - Kong — API ゲートウェイ
  - GoTrue — 認証サービス
  - PostgREST — REST API 自動生成
  - PostgreSQL 15 — データベース
- ポート: 3000（Studio UI）、8000（API Gateway）、5432（PostgreSQL）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

```bash
# サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name supabase-selfhost

# 環境変数を設定
conoha app env set myserver --app-name supabase-selfhost \
  POSTGRES_PASSWORD=your-secure-password \
  JWT_SECRET=$(openssl rand -base64 32)

# デプロイ
conoha app deploy myserver --app-name supabase-selfhost
```

## 動作確認

1. Studio UI: `http://<サーバーIP>:3000` で管理画面にアクセス
2. REST API: `http://<サーバーIP>:8000/rest/v1/` にリクエスト（apikey ヘッダーが必要）
3. Studio から Table Editor でテーブルを作成し、API で CRUD 操作

## カスタマイズ

- Next.js や SvelteKit から `@supabase/supabase-js` で接続可能
- Studio の SQL Editor でマイグレーションやファンクション作成
- 本番環境では JWT シークレットと API キーを必ず再生成してください
- ANON_KEY / SERVICE_ROLE_KEY は JWT_SECRET を元に https://supabase.com/docs/guides/self-hosting#api-keys で生成
