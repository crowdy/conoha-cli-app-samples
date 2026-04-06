# coolify

セルフホスティングの PaaS（Platform as a Service）。ConoHa VPS 上に Vercel / Netlify のような自動デプロイ環境を構築できます。

## 構成

- [Coolify](https://coolify.io/) v4 — PaaS プラットフォーム
- PostgreSQL 16 — データベース
- Redis 7 — キャッシュ・キュー
- ポート: 8000（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

> **推奨**: Coolify は公式インストールスクリプトの利用が最も簡単です。
> `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
>
> 以下は compose.yml を使ったデプロイ方法です。

```bash
# サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name coolify

# 環境変数を設定
conoha app env set myserver --app-name coolify \
  APP_KEY=$(echo "base64:$(openssl rand -base64 32)") \
  DB_PASSWORD=your-secure-password \
  REDIS_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name coolify
```

## 動作確認

ブラウザで `http://<サーバーIP>:8000` にアクセスし、初期管理者アカウントを作成します。

## カスタマイズ

- Coolify UI からアプリケーション・データベース・サービスをワンクリックでデプロイ可能
- GitHub / GitLab 連携で Push 時の自動デプロイを設定
- Let's Encrypt による自動 HTTPS 証明書取得をサポート
- `APP_KEY` は初回起動時に自動生成されますが、環境変数で事前に設定することも可能
- 本番環境では `DB_PASSWORD`、`REDIS_PASSWORD` を必ず変更してください
