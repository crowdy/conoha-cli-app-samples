# vite-react

Vite + React で構築した SPA を nginx で配信するサンプルです。フロントエンドプロジェクトのデプロイに最適です。

## 構成

- Vite 6 + React 19 + TypeScript
- nginx（静的ファイル配信）
- ポート: 80

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. デプロイ
conoha app deploy myserver
```

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスするとカウンターアプリが表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- `src/App.tsx` を編集してコンポーネントを変更
- `npm install` で追加パッケージをインストール
- `nginx.conf` でキャッシュ設定やリバースプロキシを追加
