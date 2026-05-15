# voice-agent-webrtc-realtime

ブラウザで QR を撮るだけで AI と音声会話ができ、会話の内容が Google Sheets に
リアルタイムで業務データとして書き込まれるデモサンプル。同じ「○○食堂の注文受付 AI」を
**3 つの通信プロトコル人格**(🚑 救急センター / 🪖 作戦司令部 / ☎️ コールセンター)で
切り替えられます。

電話番号も SIP トランクも不要 — 通信路は **WebRTC**、音声はブラウザと OpenAI Realtime API
を直結し、サーバーを経由しません。

## 構成

| レイヤー | 技術 |
|---|---|
| フロント | Next.js 16 (App Router, standalone) |
| バックエンド | FastAPI (Python 3.12) — ephemeral token 発行 + 注文 API + broadcast |
| 音声 AI | OpenAI Realtime API (`gpt-realtime-2`)、ブラウザ直結 WebRTC |
| 業務データ | Google Sheets (`google-api-python-client`) |

```
ブラウザ ──WebRTC(Opus)──► OpenAI Realtime API
   │  │ tool_call は DataChannel 経由でブラウザに届く
   │  └─► POST /api/orders ─► FastAPI ─► Google Sheets
   │                              └─► WS /api/events ─► 他のブラウザの OrderTicker
   └──► POST /api/realtime/session(ephemeral token 発行)
```

設計の詳細は
[`docs/superpowers/specs/2026-05-14-voice-agent-webrtc-realtime-design.md`](../docs/superpowers/specs/2026-05-14-voice-agent-webrtc-realtime-design.md)
を参照。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.3.0`
- ConoHa VPS3 アカウント、SSH キーペア
- OpenAI API キー(Realtime API 利用可能な tier)
- Google サービスアカウントと共有済みスプレッドシート
  ([`examples/sample-sheet.md`](examples/sample-sheet.md) を参照)

## 環境変数

`.env.example` をコピーして `.env` を作成:

| 変数 | 説明 |
|---|---|
| `OPENAI_API_KEY` | OpenAI API キー |
| `OPENAI_REALTIME_MODEL` | 既定 `gpt-realtime-2` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | サービスアカウント JSON を 1 行で |
| `SHEET_ID` | スプレッドシート ID |
| `RESTAURANT_NAME` | AI の挨拶に差し込む店名(例 `カフェ・コノハ`) |

## ローカル起動

```bash
cd voice-agent-webrtc-realtime
cp .env.example .env   # 値を埋める
docker compose --env-file .env up --build
```

- トップ(QR 一覧): http://localhost:3000/
- 通話画面: http://localhost:3000/talk?mode=emergency
- ヘルスチェック: http://localhost:8000/healthz

> WebRTC でマイクを使うため、`localhost` 以外で開く場合は HTTPS が必須です。

## デプロイ

```bash
# conoha.yml の hosts: を自分の FQDN に書き換える
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
conoha proxy boot --acme-email you@example.com myserver
conoha app init myserver
conoha app deploy myserver
```

`g2l-t-2 (2GB)` 推奨。

## 使い方

1. `https://<your-fqdn>/` を開くと 3 モードの QR が表示される
2. スマホで QR を撮ると `/talk?mode=...` が開く
3. 「🎤 PRESS TO TALK」を押しながら話す
4. 注文すると 📝 ご注文 にレシートが出て、Google Sheets に行が増える
5. デモ進行は [`examples/demo-script.md`](examples/demo-script.md) を参照

## テスト

バックエンドの HTTP API:

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest -v
```

フロントエンド・WebRTC・音声は実ブラウザでの手動確認です(`examples/demo-script.md`)。

## トラブルシュート

- **マイクが使えない**: iOS Safari は `getUserMedia` をボタン押下と同じ操作内でしか
  許可しません。本サンプルは PushToTalk の押下で初期化するので、ボタンを押してください。
- **音声が返ってこない**: 端末の音量・サイレントスイッチを確認。
- **`/api/realtime/session` が 503**: OpenAI のレート制限 / quota 超過。tier を確認。
- **Sheets に書き込まれない**: サービスアカウントをスプレッドシートに編集者として
  共有しているか、`SHEET_ID` が正しいかを確認。
- **OrderTicker が同期しない**: 本サンプルは bridge 単一インスタンス前提です。

## PSTN(電話)で受けたい場合

本サンプルは電話チャネルを扱いません。実電話番号で受けたい場合は、Twilio Elastic SIP
Trunking + Media Streams、Jambonz の自前ホスト、Twilio ConversationRelay などが
選択肢になります(設計書の Appendix を参照)。
