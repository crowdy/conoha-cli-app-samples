# fastapi-ai-chatbot

FastAPI と Ollama を使ったシンプルな AI チャットボットです。ブラウザから質問すると LLM が回答します。

## 構成

- Python 3.12 + FastAPI（アプリサーバー）
- Ollama + tinyllama モデル（LLM）
- ポート: 8000

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（4GB以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. デプロイ
conoha app deploy myserver
```

初回起動時に tinyllama モデルのダウンロード（約600MB）が自動で行われます。完了まで数分かかります。`ollama` は accessory として宣言されているため、blue/green 切替時もモデルは保持されます — アプリ側の更新で毎回ダウンロードし直す必要はありません。

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスするとチャット画面が表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- `compose.yml` の `ollama pull tinyllama` を別のモデル（例: `gemma3:1b`）に変更
- `main.py` の `MODEL` 変数を合わせて変更
- より大きなモデルを使う場合はメモリの多いフレーバーを選択
