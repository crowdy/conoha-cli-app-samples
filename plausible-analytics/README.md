# plausible-analytics

プライバシー重視の軽量 Web アナリティクス。Google Analytics の代替として、Cookie 不要でシンプルな解析ができます。

## 構成

- [Plausible CE](https://plausible.io/) v2.1 — Web アナリティクス
- PostgreSQL 16 — ユーザー・サイト情報
- ClickHouse 24.3 — イベントデータ（高速集計）
- ポート: 8000（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（BASE_URL は公開 FQDN に揃える — トラッキング
#    スクリプトのパスや OAuth リダイレクト URL がこの値から生成される。
#    DB_PASSWORD は DATABASE_URL に埋め込まれるため、`/` や `+` を含む
#    base64 ではなく hex で生成する — URI パーサが password 区間を
#    誤って切り詰めてしまうのを防ぐため）
#    `plausible-analytics.example.com` の部分は conoha.yml の
#    `hosts:` に合わせて自分の FQDN に置き換えてください。
conoha app env set myserver \
  BASE_URL=https://plausible-analytics.example.com \
  SECRET_KEY_BASE=$(openssl rand -base64 48) \
  DB_PASSWORD=$(openssl rand -hex 32)

# 6. デプロイ
conoha app deploy myserver
```

`db` と `clickhouse` は accessory として宣言されているため、blue/green 切替時も再起動されません。ClickHouse に溜まったイベントデータが保持されます。

## 動作確認

1. `https://<あなたの FQDN>` で管理者アカウントを作成（初回は Let's Encrypt 証明書発行に数十秒かかる場合があります）
2. サイトを追加してトラッキングスクリプトを取得
3. 対象サイトの `<head>` にスクリプトタグを追加

```html
<script defer data-domain="yourdomain.com" src="https://<あなたの FQDN>/js/script.js"></script>
```

## カスタマイズ

- Cookie 不要のため GDPR / ePrivacy 準拠（バナー不要）
- カスタムイベント、ゴール設定、UTM パラメータ解析が可能
- メール配信を設定するには SMTP 環境変数を追加
- Next.js / SvelteKit などのフロントエンドサンプルと組み合わせて利用可能
- 本番環境では `SECRET_KEY_BASE`、`DB_PASSWORD` を必ず変更してください
