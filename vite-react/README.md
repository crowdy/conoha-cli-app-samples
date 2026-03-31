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

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name react-app

# デプロイ
conoha app deploy myserver --app-name react-app
```

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスするとカウンターアプリが表示されます。

## カスタマイズ

- `src/App.tsx` を編集してコンポーネントを変更
- `npm install` で追加パッケージをインストール
- `nginx.conf` でキャッシュ設定やリバースプロキシを追加
