# voice-agent-webrtc-realtime サンプル設計書

GitHub Issue: [#100](https://github.com/crowdy/conoha-cli-app-samples/issues/100)
Branch: `feat/voice-agent-webrtc-realtime` (予定)

## 概要

ブラウザで QR コードにアクセスするだけで AI と音声会話ができ、会話中に Google Sheets が業務データとしてリアルタイムに更新されるデモサンプル。**○○食堂の注文受付 AI** という共通シナリオを、**3 つの通信プロトコル人格**(注文救急センター / 注文作戦司令部 / 注文コールセンター)で切り替えられる。

- 通信路は **WebRTC (Opus 48kHz)** を採用、電話番号・SIP トランクは一切不要
- **OpenAI Realtime API ephemeral token 方式** を使い、音声はブラウザ ↔ OpenAI を直結、サーバーは経由しない
- ConoHa VPS 1 台 + ドメイン 1 つで完結。外部 SaaS は OpenAI と Google Sheets のみ
- 観客は QR を撮るだけで自分のスマホ・ノート PC で同時体験できる

## スコープ

本サンプル v1 では以下を含む:

- M1: Next.js (`frontend/`) と FastAPI (`backend/`) の 2 サービス compose 構成
- M2: `POST /api/realtime/session` で OpenAI Realtime API の ephemeral client_secret を発行 (mode に応じた `instructions` を埋め込む)
- M3: ブラウザから OpenAI へ直結 WebRTC、DataChannel での event 送受信、push-to-talk UI
- M4: 3 つの persona (`emergency` / `military` / `callcenter`) と ModeTheme による配色・フォント分岐
- M5: `add_order` / `update_order` / `close_order` / `list_orders` の Tool Calling と Google Sheets 連携
- M6: 注文レシート (`OrderReceipt`) と字幕 (`Transcript`) のリアルタイム UI
- M7: WebSocket `/api/events` で他セッションへの注文ブロードキャスト + `OrderTicker`
- M8: `/` トップに 3 モードの QR コード
- M9: `conoha.yml` 整備、`conoha app deploy` 成功
- M10: README + デモ進行台本 + root README 登録
- M11: backend に pytest スイート (`test_session`, `test_orders`, `test_broadcast`)

以下は本 PR の対象外 (後続候補):

- 電話 (PSTN) 接続。Appendix にて Twilio Elastic SIP Trunking / Jambonz on ConoHa / ConversationRelay を選択肢として記載するのみ
- 通話録音・音声ログ永続化 (Option A の特性上、音声はサーバーを通過しない)
- 認証・課金 (公開デモを想定。レート制限は OpenAI 側 quota に依存)
- 多インスタンス対応 (Redis Pub/Sub 等)。本サンプルは bridge 単一インスタンス前提
- E2E ブラウザテスト (Playwright)、WebRTC のフェイク audio 入力テスト

## 主要決定事項

| 項目 | 決定 | 根拠 |
|------|------|------|
| Realtime API 接続トポロジ | **Ephemeral token + ブラウザ直結 WebRTC** | 2025 年秋以降の OpenAI 推奨パターン。bridge から aiortc を排除でき、コード量が約半分。学習資料としての価値が高い。coturn 不要 (OpenAI 側 TURN を利用) |
| Tool call 発生場所 | **ブラウザ** | OpenAI が DataChannel 経由でブラウザに `response.function_call_arguments.done` を投げる → ブラウザが `/api/orders` を HTTP で叩く → `function_call_output` を DataChannel で OpenAI に返す |
| 字幕 (transcript) ソース | **OpenAI DataChannel の `audio_transcript.delta` と `input_audio_transcription.completed`** | サーバー経由なしで字幕が動く。バックエンドは関与しない |
| OrderTicker 同期方式 | **bridge インメモリ broadcast (単一インスタンス)** | Redis Pub/Sub は過剰。Sheets ポーリングは 5 秒遅延でリアルタイム感を損なう。最近 50 件をキャッシュし、新規 WS 接続時に流す |
| Sheets API クライアント | **`google-api-python-client`** | 標準的でドキュメント豊富、Cookbook 検索性が高い。`gspread` は薄いが学習資料としては低レベル API のほうが応用が利く |
| Sheets 認証 | **Service Account JSON を環境変数に直接 (`GOOGLE_APPLICATION_CREDENTIALS_JSON`)** | ConoHa env 注入と相性が良い。`json.loads` → `service_account.Credentials.from_service_account_info` |
| Persona 管理 | **`backend/app/personas/*.md` を起動時メモリロード** | フロントには露出しない。`POST /api/realtime/session` 応答に `instructions` として埋め込む |
| ディレクトリ命名 | **`frontend/` + `backend/`** | `nextjs-fastapi-postgresql` 既存サンプルと一致 |
| Next.js | **16.x / App Router / `output: standalone`** | リポジトリ標準。`/api/*` を backend に rewrite |
| Python | **3.12-slim, single-stage Dockerfile** | リポジトリ標準 (`fastapi-ai-chatbot` / `nextjs-fastapi-postgresql` と同一) |
| 設定読み込み | **`os.environ.get` 直叩き** | リポジトリ標準。pydantic-settings は採用しない |
| サブドメイン | **単一ホスト + `/api/*` rewrite** | Issue #100 当初案の `bridge.voice-agent.example.com` 分割は不要 (frontend が backend を内部 hostname `backend:8000` で参照) |
| Blue/Green | **`backend` は accessories**、frontend のみ slot 切替 | WebSocket セッションを保つため |
| デフォルト VAD | **push-to-talk** | 会場の暗騒音を考慮。設定で `server_vad` に切替可 |
| テスト方針 | **pytest で bridge HTTP API のみ**、フロント/WebRTC は手動 | 自動化価値の高い領域に絞る (`dns-server` 路線) |

## アーキテクチャ

### コンポーネント

```
┌──────────────────────────────────────────────────────────────────────┐
│  ブラウザ (Next.js /talk?mode=...)                                    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐         │
│  │ PushToTalk     │  │ OrderReceipt   │  │ Transcript     │         │
│  └────────────────┘  └────────────────┘  └────────────────┘         │
│  ┌────────────────┐  ┌────────────────────────────────────┐         │
│  │ OrderTicker    │  │ lib/realtime.ts (WebRTC + DataCh)  │         │
│  └────────────────┘  └────────────────────────────────────┘         │
└──────┬─────────────────────┬─────────────────────────────────────────┘
       │ HTTP/WS             │ WebRTC (Opus + DataChannel)
       │ /api/*              │ ephemeral token authenticated
       ▼                     ▼
┌──────────────────┐   ┌─────────────────────────────────────┐
│ FastAPI backend  │   │ OpenAI Realtime API                 │
│ - /api/realtime/ │   │ gpt-realtime-2                      │
│   session        │   │ - session.update (persona, tools[]) │
│ - /api/orders/*  │   │ - response.function_call_arguments  │
│ - WS /api/events │   │ - audio_transcript.delta            │
│ - broadcast hub  │   └─────────────────────────────────────┘
│ - sheets client  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Google Sheets    │
│ values.append    │
│ values.update    │
└──────────────────┘
```

### モジュール責務

#### Frontend (Next.js)

| モジュール | 責務 |
|------|------|
| `app/page.tsx` | 3 モードの QR コードを表示するトップページ |
| `app/talk/page.tsx` | `?mode=` を受け取り、`useEffect` で `lib/realtime.ts` を初期化 |
| `lib/realtime.ts` | `POST /api/realtime/session` → ephemeral token 取得 → OpenAI WebRTC PeerConnection → DataChannel の event ルーティング |
| `lib/tools.ts` | DataChannel で受信した `response.function_call_arguments.done` を解釈し、`/api/orders/*` を呼び出し、`function_call_output` を返送 |
| `lib/events.ts` | WS `/api/events` 接続。受信した OrderTicker イベントを React state に反映 |
| `components/PushToTalk.tsx` | iOS Safari の user gesture 要件を満たすマイク取得トリガ |
| `components/OrderReceipt.tsx` | 自セッションの注文項目をレシート風に表示。`order_event` を購読 |
| `components/Transcript.tsx` | ユーザー発話 / AI 発話を字幕として時系列表示 |
| `components/OrderTicker.tsx` | 他セッション分の注文を流す |
| `components/ModeTheme.tsx` | `mode` クエリに応じて Tailwind class group を切替 (色・フォント) |

#### Backend (FastAPI)

| モジュール | 責務 |
|------|------|
| `app/main.py` | FastAPI 初期化、lifespan で Sheets client と broadcast hub を準備、router 登録 |
| `app/settings.py` | `os.environ.get` ベースの設定読み込み |
| `app/routers/realtime.py` | `POST /api/realtime/session` — OpenAI Realtime ephemeral key 発行、persona 解決 |
| `app/routers/orders.py` | `POST /api/orders`, `PATCH /api/orders/{id}`, `POST /api/orders/{id}/close`, `GET /api/orders/recent` |
| `app/routers/events.py` | `WS /api/events` — broadcast hub に subscribe |
| `app/sheets.py` | `google-api-python-client` ラッパ (append / update / list) |
| `app/broadcast.py` | インメモリ WS hub、最近 50 件のリングバッファ、新規接続時に再生 |
| `app/personas/__init__.py` | `*.md` を辞書にロード |
| `app/personas/{emergency,military,callcenter}.md` | システムプロンプト本文 (日/英/韓 多言語指示も含む) |

## データフロー

### 起動 〜 セッション確立

1. ブラウザ: `GET /talk?mode=emergency`
2. ブラウザ: `POST /api/realtime/session { mode: "emergency" }`
3. backend: OpenAI `POST /v1/realtime/sessions` を呼び、ephemeral `client_secret` を取得
4. backend: `personas["emergency"]` を埋めた session config と client_secret を返す
5. ブラウザ: `RTCPeerConnection` を作成、DataChannel `oai-events` を open
6. ブラウザ: OpenAI に SDP offer を送信 (`POST https://api.openai.com/v1/realtime?model=gpt-realtime-2` to `Authorization: Bearer <ephemeral>`)、answer を受信
7. ブラウザ: DataChannel が open になったら `session.update { instructions, voice, input_audio_transcription, tools }` を送信
8. ブラウザ: `WS /api/events` にも並行接続 (OrderTicker 用)

### 会話 〜 注文書き込み

1. ユーザーが PushToTalk を長押し → `getUserMedia` ストリームを `addTrack` (既に WebRTC は確立済み、マイク mute/unmute 切替で実装)
2. OpenAI からの音声デルタは PeerConnection の audio track 経由で自動再生
3. AI が `add_order` を呼ぶと判定したら、DataChannel に `response.function_call_arguments.done` 到着
4. ブラウザ `lib/tools.ts`:
   - (a) `OrderReceipt` に楽観的に追加 (見た目を即時更新)
   - (b) `POST /api/orders { items, mode, language, customer_label }` を発行
   - (c) backend: `sheets.append` を呼び、`order_id` を採番、`broadcast.publish` を呼ぶ
   - (d) ブラウザに `{ order_id, status: "persisted" }` 応答
   - (e) ブラウザ: `OrderReceipt` の該当項目に ✓ チェックを付ける
   - (f) ブラウザ: DataChannel に `conversation.item.create { type: "function_call_output", call_id, output: order_id }` 送信
   - (g) ブラウザ: DataChannel に `response.create` 送信 → AI が音声で復唱
5. 他の talk セッションの `OrderTicker` には backend の broadcast 経由で同時に到着

### 字幕 (転写)

- ユーザー発話: DataChannel に `conversation.item.input_audio_transcription.completed { transcript }` → `Transcript` に push
- AI 発話: DataChannel に `response.audio_transcript.delta { delta }` を順次連結 → `Transcript` に append
- いずれもバックエンドを経由しない

## API インターフェース

### `POST /api/realtime/session`

Request:
```json
{ "mode": "emergency" }
```

Response (200):
```json
{
  "client_secret": "ek_...",
  "expires_at": "2026-05-14T12:00:00Z",
  "model": "gpt-realtime-2",
  "session": {
    "instructions": "...(persona markdown)...",
    "voice": "alloy",
    "input_audio_transcription": { "model": "whisper-1" },
    "turn_detection": { "type": "none" },
    "tools": [ /* add_order, update_order, close_order, list_orders */ ]
  }
}
```

`mode` 不正・未指定時は `callcenter` を採用。OpenAI 側エラーは 503 で透過。

### `POST /api/orders`

Request:
```json
{
  "mode": "emergency",
  "customer_label": "テーブル 3",
  "language": "ja",
  "items": [ { "name": "カルボナーラ", "qty": 2, "note": null } ]
}
```

Response (201):
```json
{ "order_id": "ord_01HV…", "created_at": "...", "status": "open" }
```

副作用: Sheets `values.append` + broadcast hub に `{ type: "order_added", payload: {...} }` を publish。

### `PATCH /api/orders/{id}`

Request:
```json
{ "items": [{ "name": "カルボナーラ", "qty": 3 }], "notes": "やっぱり 3 つ" }
```

Response (200): `{ "order_id": "...", "status": "open" }`

副作用: Sheets `values.update` (該当行を上書き) + broadcast。

### `POST /api/orders/{id}/close`

Response (200): `{ "order_id": "...", "status": "closed" }`

副作用: Sheets G 列を `closed` に + broadcast。

### `GET /api/orders/recent?limit=20`

Response (200): `{ "orders": [ ... 最近の 20 件 ... ] }` — 新規 WS 接続時のリングバッファ補填用。

### `WS /api/events`

接続時に最近 50 件をリプレイ、以降は `order_added` / `order_updated` / `order_closed` を即時 push。クライアントからの送信は無視。

## Tool 定義 (Realtime `tools[]`)

```jsonc
[
  {
    "type": "function",
    "name": "add_order",
    "description": "新しい注文を業務システムに追加する。お客様が注文した品目と数量を Items 配列にすべて含めること。",
    "parameters": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "qty":  { "type": "integer", "minimum": 1 },
              "note": { "type": ["string", "null"] }
            },
            "required": ["name", "qty"]
          }
        },
        "customer_label": { "type": "string", "description": "席・現場の呼称。モードに応じて適切な言い回しを採用" },
        "language":       { "type": "string", "enum": ["ja", "en", "ko"] }
      },
      "required": ["items", "language"]
    }
  },
  {
    "type": "function",
    "name": "update_order",
    "description": "直前の注文の数量や品目を変更する",
    "parameters": {
      "type": "object",
      "properties": {
        "order_id": { "type": "string" },
        "items":    { "type": "array", "items": { "type": "object" }, "description": "変更後の全品目 (差分ではなく置換)" },
        "notes":    { "type": ["string", "null"] }
      },
      "required": ["order_id", "items"]
    }
  },
  {
    "type": "function",
    "name": "close_order",
    "description": "注文を確定する。お礼の言葉の直前に呼ぶこと",
    "parameters": {
      "type": "object",
      "properties": { "order_id": { "type": "string" } },
      "required": ["order_id"]
    }
  },
  {
    "type": "function",
    "name": "list_orders",
    "description": "当日の最近の注文を確認する (使用頻度低、復旧用)",
    "parameters": {
      "type": "object",
      "properties": { "limit": { "type": "integer", "default": 10 } },
      "required": []
    }
  }
]
```

`order_id` は `add_order` 実行時にブラウザが `function_call_output` で AI に返した値を、AI がセッション内で記憶して以降の `update_order` / `close_order` に渡す。

## Google Sheets スキーマ

| A: order_id | B: created_at | C: mode | D: customer_label | E: items_json | F: language | G: status | H: notes |
|---|---|---|---|---|---|---|---|

- `order_id`: ULID (`ord_01HV…`)
- `items_json`: JSON 文字列 (`[{"name":"カルボナーラ","qty":2,"note":null}]`)
- `status`: `open` / `closed`
- 条件付き書式で C 列を赤(緊急)/緑(作戦)/青(コール) に色分け (README に手順)

## エラー処理

| 状況 | 処理 |
|------|------|
| Ephemeral token 60s 内に再発行失敗 | ブラウザが自動再発行 → 切れた場合は "もう一度お話しください" を表示 |
| Sheets API 5xx | `/api/orders` が 502 を返す。ブラウザは OrderReceipt に ⚠ + "再試行中"。3 回指数バックオフ後にあきらめ、メモリに残るが Sheets には反映されない |
| OpenAI quota / 429 | `/api/realtime/session` が 503 を返し、ブラウザは "現在混雑しています" を表示 |
| WebRTC ICE 失敗 | ブラウザ側 3 回再試行。失敗時はトラブルシュートリンクを表示 |
| `mode` 不正 | `callcenter` にフォールバック |
| WS 接続切断 | 自動再接続 (exponential backoff)、再接続時はリングバッファをリプレイ |

## テスト

| ファイル | 検証 |
|---|---|
| `backend/tests/test_session.py` | `/api/realtime/session` が mode ごとに正しい instructions を埋めるか (OpenAI 側は `httpx_mock` で stub) |
| `backend/tests/test_orders.py` | `add/update/close` で Sheets stub に正しい呼び出しが入り、broadcast hub に publish されるか |
| `backend/tests/test_broadcast.py` | 2 つの WS クライアントが接続中に片方の publish がもう一方に届くか + リングバッファ replay |

`conftest.py` は Sheets client・OpenAI httpx client を fixture で差し替え。

## デプロイ構成

```yaml
# conoha.yml
name: voice-agent-webrtc-realtime
hosts:
  - voice-agent.example.com
web:
  service: frontend
  port: 3000
accessories:
  - backend
```

```yaml
# compose.yml (要点)
services:
  frontend:
    build: ./frontend
    expose: ["3000"]
    environment:
      - BACKEND_URL=http://backend:8000
    depends_on:
      backend: { condition: service_healthy }
  backend:
    build: ./backend
    expose: ["8000"]
    environment:
      - OPENAI_API_KEY
      - OPENAI_REALTIME_MODEL=gpt-realtime-2
      - GOOGLE_APPLICATION_CREDENTIALS_JSON
      - SHEET_ID
      - RESTAURANT_NAME
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"]
      interval: 10s
```

- 推奨フレーバ: `g2l-t-2 (2GB)`
- 必須 env 一覧は `.env.example` (gitignore) + README に明記

## 既知の落とし穴

- **iOS Safari の user gesture**: `getUserMedia` は onclick 同期チェーン内で呼ぶ必要がある。`PushToTalk` の onPointerDown で呼ぶ
- **Realtime API DataChannel name**: 公式仕様で `"oai-events"` 固定
- **session.update のタイミング**: DataChannel `onopen` を待ってから送る (race condition 防止)
- **tool_call の duplicate 防止**: `call_id` を見て重複処理を避ける
- **多言語切替時の persona 維持**: persona .md に "言語が変わっても本モードの通信プロトコルは維持" を明記
- **同時接続数**: OpenAI のレート制限 (Tier 別) に依存。プロジェクター用にデモ前に手動で 3〜5 セッションを試走
- **Sheets quota**: 100 リクエスト/100 秒 (デフォルト)。デモなら問題なし
- **Persona .md の編集反映**: 起動時ロードのみ。修正時はコンテナ再起動

## 実装 PR 分割

1. **`feat: skeleton`** — Next.js + FastAPI スケルトン、compose.yml、conoha.yml、Dockerfile
2. **`feat: ephemeral token endpoint`** — `/api/realtime/session` + OpenAI API 呼び出し
3. **`feat: webrtc client`** — `lib/realtime.ts` で OpenAI 直結 (音声のみ、tool なし)
4. **`feat: 3 personas + ModeTheme`** — .md ロードと UI 色分岐
5. **`feat: orders CRUD + sheets`** — `routers/orders.py` + `sheets.py` + pytest
6. **`feat: tool_call wiring`** — `lib/tools.ts` の tool_call → /api/orders → function_call_output
7. **`feat: order receipt + transcript UI`** — `OrderReceipt` + `Transcript`
8. **`feat: ws broadcast + OrderTicker`** — `routers/events.py` + hub + フロント
9. **`feat: QR landing page`** — `/` に 3 モードの QR
10. **`docs`** — README + デモ進行台本 + root README 登録

## Appendix: PSTN 拡張 (実装しない)

本サンプル完成後の拡張オプション。いずれも本 bridge を流用可能。

- **Twilio Elastic SIP Trunking + Media Streams**: 番号購入 + TwiML + Twilio Stream を OpenAI Realtime にブリッジする派生サンプル
- **Jambonz on ConoHa**: Twilio 互換 API を自前ホスト、SIP Trunk のみ外注。完全自営 CPaaS
- **Twilio ConversationRelay**: STT/TTS は Twilio 側、テキストだけ自前。speech-to-speech プロソディは失われる

## 関連リンク

- [OpenAI Realtime API: gpt-realtime-2](https://platform.openai.com/docs/guides/realtime-conversations)
- [OpenAI Realtime sessions (ephemeral token)](https://platform.openai.com/docs/api-reference/realtime-sessions)
- [Google Sheets values.append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append)
- 既存類似サンプル: [nextjs-fastapi-postgresql](../../../nextjs-fastapi-postgresql/), [dns-server](../../../dns-server/), [fastapi-ai-chatbot](../../../fastapi-ai-chatbot/)
