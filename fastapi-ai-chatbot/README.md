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

## デプロイ

```bash
# サーバー作成（4GB以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name chatbot

# デプロイ
conoha app deploy myserver --app-name chatbot
```

初回起動時に tinyllama モデルのダウンロード（約600MB）が自動で行われます。完了まで数分かかります。

## 動作確認

ブラウザで `http://<サーバーIP>:8000` にアクセスするとチャット画面が表示されます。

## カスタマイズ

- `compose.yml` の `ollama pull tinyllama` を別のモデル（例: `gemma3:1b`）に変更
- `main.py` の `MODEL` 変数を合わせて変更
- より大きなモデルを使う場合はメモリの多いフレーバーを選択
