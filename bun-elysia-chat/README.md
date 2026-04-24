# bun-elysia-chat

Bun と Elysia を使ったリアルタイムチャットアプリです。WebSocket によるメッセージ配信と SQLite によるチャット履歴保存を行います。

## 構成

- Bun ランタイム
- Elysia（WebSocket 対応 Web フレームワーク）
- SQLite（bun:sqlite、ファイルベース DB）
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

ブラウザで `https://<あなたの FQDN>` にアクセスすると、ニックネーム入力後にチャットルームに参加できます。複数ブラウザタブで開くとリアルタイム通信を確認できます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## 特徴

- **WebSocket リアルタイム通信** — メッセージ即時配信
- **チャット履歴** — SQLite にメッセージ保存、接続時に過去メッセージをロード
- **オンライン人数表示** — 接続中のユーザー数をリアルタイム表示
- **単一コンテナ** — DB サービス不要、軽量構成

## カスタマイズ

- `src/ws.ts` で WebSocket のメッセージ処理をカスタマイズ
- `src/db.ts` でデータベーススキーマを変更
- SQLite データは Docker ボリューム（`/data/chat.db`）に永続化

## 制限事項

- オンラインユーザー一覧はプロセス内メモリで保持するため、**単一レプリカ前提** の構成です。複数レプリカでスケールする場合は、プレゼンス情報を Redis などの共有ストアに移す必要があります。
- ニックネームは最大 32 文字、メッセージは最大 2000 文字に制限されています（`src/ws.ts` で調整可能）。
