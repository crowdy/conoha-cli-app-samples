# gitea

Gitea と PostgreSQL を使ったセルフホスティング Git サービスです。GitHub/GitLab の軽量代替として日本企業でも人気があります。

## 構成

- Gitea（公式イメージ）
- PostgreSQL 17（公式イメージ）
- ポート: 3000（Web）、2222（SSH）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name gitea

# 環境変数を設定（パスワードを変更してください）
conoha app env set myserver --app-name gitea \
  DB_PASSWORD=your_db_password

# デプロイ
conoha app deploy myserver --app-name gitea
```

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスすると初期セットアップ画面が表示されます。

Git SSH アクセス:
```bash
git clone ssh://git@<サーバーIP>:2222/user/repo.git
```

## カスタマイズ

- 初期セットアップ画面でサイト名、管理者アカウントを設定
- `GITEA__` プレフィックスの環境変数で設定を変更可能
- HTTPS が必要な場合は nginx リバースプロキシを前段に追加
- CI/CD には Gitea Actions（GitHub Actions 互換）が利用可能
