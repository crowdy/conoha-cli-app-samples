# hello-world

nginx で静的HTMLを配信する最もシンプルなサンプルです。初めて `conoha app deploy` を試す方におすすめです。

## 構成

- nginx (Alpine)
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
conoha app init myserver --app-name hello-world

# デプロイ
conoha app deploy myserver --app-name hello-world
```

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスすると「Hello from ConoHa!」と表示されます。

## カスタマイズ

`index.html` を編集して再度 `conoha app deploy` するだけで更新できます。
