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

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name sveltekit-app

# デプロイ
conoha app deploy myserver --app-name sveltekit-app
```

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスするとカウンターアプリが表示されます。

## カスタマイズ

- `src/routes/` にファイルを追加してルーティング
- `svelte.config.js` で SvelteKit の設定を変更
- 静的サイトにしたい場合は `adapter-static` に変更
