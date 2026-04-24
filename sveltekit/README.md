# sveltekit

SvelteKit アプリを adapter-node でデプロイするサンプルです。SSR 対応のモダンフレームワークです。

## 構成

- SvelteKit 2 + Svelte 5 + TypeScript
- adapter-node（Node.js サーバー）
- ポート: 3000

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

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

- `src/routes/` にファイルを追加してルーティング
- `svelte.config.js` で SvelteKit の設定を変更
- 静的サイトにしたい場合は `adapter-static` に変更
