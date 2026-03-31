# nextjs

Next.js アプリをスタンドアロンモードでデプロイするサンプルです。マルチステージビルドで軽量なイメージを生成します。

## 構成

- Node.js 22 + Next.js 15 (standalone output)
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
conoha app init myserver --app-name nextjs

# デプロイ
conoha app deploy myserver --app-name nextjs
```

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスすると「Next.js on ConoHa」と表示されます。

## カスタマイズ

- `app/page.tsx` を編集してページ内容を変更
- `app/` 以下にファイルを追加して App Router でルーティング
- `next.config.ts` で Next.js の設定を変更
