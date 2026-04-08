# rails-mercari

Mercari 風の中古マーケットプレイスアプリです。商品の出品・購入と、Sidekiq による非同期通知を備えています。

## 構成

- Ruby 3.4 + Rails 8.1
- PostgreSQL 17
- Redis 7
- Sidekiq 7.3（非同期ジョブ）
- Nginx（リバースプロキシ）
- Dex（OIDC 認証プロバイダ）
- ポート: 80（Nginx）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

### サーバー作成（まだない場合）

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
```

### デプロイ

```bash
# アプリ初期化
conoha app init myserver --app-name mercari

# デプロイ
conoha app deploy myserver --app-name mercari
```

サーバーの IP アドレスを確認して、Dex の issuer ホストを設定します：

```bash
# サーバーIPを確認
conoha server show myserver

# .env.server を作成（サーバーIPに置き換え）
cat > .env.server << 'EOF'
DEX_ISSUER_HOST=<SERVER_IP>
RAILS_HOST=<SERVER_IP>
EOF

# 再デプロイ
conoha app deploy myserver --app-name mercari
```

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスします。

### テストユーザー

| メールアドレス | パスワード | 役割 |
|---------------|-----------|------|
| seller@example.com | password | 出品者 |
| buyer@example.com | password | 購入者 |

### 操作手順

1. 「Dex でログイン」→ seller@example.com でログイン
2. 「出品する」から商品を登録
3. ログアウト → buyer@example.com でログイン
4. 商品の「購入する」ボタンをクリック
5. `conoha app logs myserver --app-name mercari` で Sidekiq の通知ログを確認

## カスタマイズ

- `app/controllers/` と `app/views/` を編集して機能を追加
- `db/migrate/` に新しいマイグレーションを追加してスキーマを変更
- 本番環境では `.env.server` で `SECRET_KEY_BASE`、`DB_PASSWORD` を管理
- Dex に外部 OIDC コネクタ（GitHub、Google 等）を追加可能
