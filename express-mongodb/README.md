# express-mongodb

Express.js と MongoDB を使ったシンプルな投稿アプリです。Mongoose による CRUD 機能を持ちます。

## 構成

- Node.js 22 + Express.js 5
- MongoDB 8
- ポート: 3000

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name express-app

# デプロイ
conoha app deploy myserver --app-name express-app
```

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスすると投稿一覧ページが表示されます。

## カスタマイズ

- `app.js` にルートを追加して機能を拡張
- `views/` に EJS テンプレートを追加
- MongoDB は認証なしで起動するため、本番環境では認証設定を追加
