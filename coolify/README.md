# coolify

セルフホスティングの PaaS（Platform as a Service）。ConoHa VPS 上に Vercel / Netlify のような自動デプロイ環境を構築できます。

## 構成

- [Coolify](https://coolify.io/) v4 — PaaS プラットフォーム
- PostgreSQL 16 — データベース（accessory）
- Redis 7 — キャッシュ・キュー（accessory）
- proxy 公開ポート: 8000（HTTP UI）
- 内部のみ: 6001（Soketi / socket.io 用）、6002（Laravel Reverb 用）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

> **推奨**: Coolify は公式インストールスクリプトの利用が最も簡単です。
> `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
>
> 以下は conoha-proxy 経由で Coolify を立てる手順です。

```bash
# 1. サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — compose のデフォルト値は
#    公開リポジトリに記載されています。APP_URL は Coolify が生成する
#    リンクの基準 URL なので、公開 FQDN に揃えてください）
conoha app env set myserver \
  APP_KEY=base64:$(openssl rand -base64 32) \
  APP_URL=https://coolify.example.com \
  DB_PASSWORD=$(openssl rand -base64 32) \
  REDIS_PASSWORD=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

`postgres` と `redis` は accessory として宣言されているため、blue/green 切替時も再起動されません。

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスし、初期管理者アカウントを作成します。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

### realtime UI 機能の制限

Coolify のデプロイ進捗ストリーム表示は内部で **socket.io (port 6001)** と **Laravel Reverb (port 6002)** を使います。conoha-proxy は HTTP のホストにつき 1 ポートしかフロントしないため、これらの WebSocket 接続は公開 FQDN 経由では到達できません。**通常の管理画面操作（プロジェクト作成、デプロイ実行、ログ閲覧）は問題ありません**が、リアルタイム進捗バーやライブログ更新は手動リフレッシュに代わります。

サーバー内部からは正常に動作するため、リアルタイム機能を本番で使いたい場合は次のいずれかを検討してください:

- 公式インストールスクリプトでデプロイし、Coolify 同梱の Caddy にすべての routing を任せる（このサンプルの目的とは外れます）
- conoha-proxy をスキップして `--no-proxy` モードで Coolify を立て、Coolify 自身で TLS 終端させる

## カスタマイズ

- Coolify UI からアプリケーション・データベース・サービスをワンクリックでデプロイ可能
- GitHub / GitLab 連携で Push 時の自動デプロイを設定
- Let's Encrypt による自動 HTTPS 証明書取得をサポート
- `APP_KEY` は初回起動時に自動生成されますが、環境変数で事前に設定することも可能
- 本番環境では `DB_PASSWORD`、`REDIS_PASSWORD` を必ず変更してください
