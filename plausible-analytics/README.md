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

## デプロイ

```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name plausible-analytics

# 環境変数を設定
conoha app env set myserver --app-name plausible-analytics \
  BASE_URL=http://your-server-ip:8000 \
  SECRET_KEY_BASE=$(openssl rand -base64 48) \
  DB_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name plausible-analytics
```

## 動作確認

1. `http://<サーバーIP>:8000` で管理者アカウントを作成
2. サイトを追加してトラッキングスクリプトを取得
3. 対象サイトの `<head>` にスクリプトタグを追加

```html
<script defer data-domain="yourdomain.com" src="http://<サーバーIP>:8000/js/script.js"></script>
```

## カスタマイズ

- Cookie 不要のため GDPR / ePrivacy 準拠（バナー不要）
- カスタムイベント、ゴール設定、UTM パラメータ解析が可能
- メール配信を設定するには SMTP 環境変数を追加
- Next.js / SvelteKit などのフロントエンドサンプルと組み合わせて利用可能
- 本番環境では `SECRET_KEY_BASE`、`DB_PASSWORD` を必ず変更してください
