# voice-agent-conoha-l4 サンプル設計書

## 概要

ConoHa VPS3 の NVIDIA L4 GPU フレーバー (`g2l-t-c4m16g1-l4`) 上に
**自己ホスト型の音声エージェント** を構築するサンプル。ブラウザで QR を
読み取ると WebRTC で音声会話ができ、AI が業務系ツール (注文受付) を
function calling で実行し、Google Sheets にリアルタイム書き込みする。

`voice-agent-webrtc-realtime` (PR #105、OpenAI Realtime API 依存) の
後継。同じユースケースをすべて自己ホストの GPU 推論で実現する。
OpenAI への外部通信は一切なし、GMO 内部の OpenAI 利用制限下でも動作可能。

## 既存サンプルとの位置づけ

| サンプル | 音声 AI | 外部依存 | GPU | 用途 |
|---|---|---|---|---|
| `voice-agent-webrtc-realtime` (撤回予定) | OpenAI Realtime API | OpenAI 必須 | 不要 | OpenAI 連携のリファレンス |
| **`voice-agent-conoha-l4` (本サンプル)** | 自己ホスト Pipecat (Whisper + vLLM + SBV2) | なし | L4 24GB 必須 | 自己ホスト音声エージェントのリファレンス |
| `vllm-gpu` | — | — | L4 | LLM 推論サーバー単体 |
| `fish-speech-tts-gpu` | TTS 単体 | — | L4 | 音声合成のリファレンス |

本サンプルは `vllm-gpu` と `fish-speech-tts-gpu` の組み合わせ事例としても
位置付けられる (両サンプルのパターンを内部で再利用)。

## アーキテクチャ

### 全体図

```
Browser ── WebRTC (Opus, 双方向) ──► agent コンテナ (aiortc transport)
   │                                       │
   │                                       ├─ Silero VAD (turn detection)
   │ DataChannel (UI 同期イベント) ◄───────┤
   │                                       ├─► faster-whisper (STT, ja/en/ko 自動)
   │                                       │
   │                                       ├─► HTTP → llm コンテナ (vLLM /v1/chat/completions)
   │                                       │             ↓ tool_calls
   │                                       │       add_order / update_order / close_order
   │                                       │             ↓
   │                                       ├─► HTTP → backend コンテナ /api/orders → Sheets
   │                                       │
   │                                       └─► Style-BERT-VITS2 (TTS, Opus フレーム出力)
   │
   └─► HTTP /api/orders (PATCH/GET), WS /api/events
       (他のブラウザの OrderTicker 用 — 変更なし)
```

### サービス構成

| サービス | ベースイメージ | ポート (内部) | GPU | 役割 |
|---|---|---|---|---|
| frontend | `node:22-alpine` (multistage) | 3000 | 不要 | Next.js 16、QR + /talk |
| agent | `nvidia/cuda:12.4-runtime-ubuntu24.04` | 8080 | 必要 | Pipecat パイプライン、aiortc WebRTC |
| llm | `vllm/vllm-openai:latest` | 8000 | 必要 (共有) | OpenAI 互換 LLM サーバー |
| backend | `python:3.12-slim` | 8000 | 不要 | 注文 API、Sheets 連携、WS fan-out |

`agent` と `llm` は同じ L4 GPU を共有する (CUDA_VISIBLE_DEVICES=0、両者で
合計 VRAM ≤ 20 GB を予算枠とする)。`llm` を別コンテナに分離するのは
コールドスタートが長い (60s+) ため、`agent` の再起動と独立したライフ
サイクルを持たせ、`vllm-gpu` サンプルとパターンを揃えるため。

### ディレクトリ構造

```
voice-agent-conoha-l4/
├── compose.yml
├── conoha.yml
├── .env.example
├── README.md                   # 日本語
├── README-ko.md
├── README-en.md
├── .dockerignore
├── frontend/                   # Next.js 16, standalone
│   ├── Dockerfile
│   ├── package.json
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx            # QR 3 枚
│   │   └── talk/page.tsx       # 音声会話画面
│   ├── components/
│   │   ├── OrderReceipt.tsx
│   │   └── OrderTicker.tsx
│   └── lib/
│       ├── voice.ts            # 新規: agent /offer と SDP 交換のみ
│       └── types.ts
├── agent/                      # Python 3.12, GPU
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── requirements.txt
│   ├── server.py               # FastAPI: POST /offer, GET /healthz
│   ├── transport.py            # aiortc WebRTC server
│   ├── pipeline.py             # Pipecat: VAD→STT→LLM→TTS
│   ├── personas.py             # 3 モードの system prompt
│   ├── tools.py                # add/update/close/list_orders → backend HTTP
│   ├── tests/
│   │   ├── test_tools.py
│   │   ├── test_personas.py
│   │   └── test_transport.py
│   └── models/                 # weight キャッシュ用ボリュームマウント先
├── llm/                        # vLLM、設定のみ
│   ├── Dockerfile              # vllm/vllm-openai:latest を ENTRYPOINT 化
│   └── entrypoint.sh
└── backend/                    # FastAPI、PR #105 から流用 + 簡素化
    ├── Dockerfile
    ├── pyproject.toml
    ├── requirements.txt
    ├── app/
    │   ├── main.py
    │   ├── settings.py
    │   ├── security.py         # Origin allowlist、一般 rate limit (session_rate_limit は削除)
    │   ├── models.py           # mode は Literal["emergency","military","callcenter"]
    │   ├── sheets.py
    │   └── routers/
    │       ├── orders.py
    │       └── events.py
    └── tests/
        ├── test_orders.py
        └── test_security.py
```

## コンポーネント詳細

### agent

Pipecat-based の音声パイプライン。本サンプルの中核であり、撤回予定の
`voice-agent-webrtc-realtime/backend/app/routers/realtime.py` を置き換える。

**HTTP インターフェイス (ブラウザ ← agent):**

| メソッド | パス | 用途 |
|---|---|---|
| `POST` | `/offer` | body `{sdp, mode}` → response `{sdp, session_id}`。SDP 交換のみ。 |
| `GET` | `/healthz` | STT/LLM/TTS の warmup 完了後のみ 200。それまでは 503。 |
| `GET` | `/modes` | 利用可能モード一覧 (frontend が QR ラベル用に取得) |

**Pipecat パイプライン:**

```python
WebRTCTransport.input
  → SileroVADAnalyzer (interruption=on)
  → WhisperSTTService (faster-whisper, model="medium", lang=auto)
  → LLMService(base_url="http://llm:8000/v1",
               model="Qwen/Qwen2.5-7B-Instruct-AWQ",
               tools=[add_order, update_order, close_order, list_orders],
               tool_choice="auto")
  → ToolCallExecutor (→ backend HTTP)
  → SBV2TTSService (mode 別 voice_id、stream=True)
  → WebRTCTransport.output
```

**DataChannel イベント (UI 同期、音声とは別):**

| type | 方向 | 用途 |
|---|---|---|
| `user_transcript` | agent → browser | STT 結果を画面に表示 |
| `assistant_text` | agent → browser | AI 応答の字幕 (任意) |
| `tool_call` | agent → browser | 楽観的 UI 更新 (注文追加中 spinner) |
| `order_persisted` | agent → browser | Sheets 永続化完了 (✓ 表示) |
| `error` | agent → browser | エラー通知 |

### llm

vLLM 公式イメージを直接利用。コードは ENTRYPOINT 1 本のみ。

```bash
exec python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct-AWQ \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.40 \
  --quantization awq_marlin \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

`--gpu-memory-utilization 0.40` で **VRAM を agent (Whisper + SBV2)
と共有**。24 GB × 0.40 ≈ 9.6 GB を vLLM が確保 (モデル本体 5 GB + KV
キャッシュ約 4 GB)。

`--enable-auto-tool-choice` + Hermes パーサーで Qwen の function
calling 出力を OpenAI 互換レスポンスに正規化。

### backend

PR #105 のコードを流用しつつ、以下を変更:

**削除:**
- `routers/realtime.py` (OpenAI session minter)
- `tools_schema.py` (OpenAI 形式の tool 定義)
- `security.py` の `session_rate_limit` 関数

**維持:**
- `routers/orders.py` (POST/PATCH/GET `/api/orders`、`/close`、`/recent`)
- `routers/events.py` (WS `/api/events` の fan-out)
- `sheets.py`
- `security.py` の Origin allowlist

`personas.py` は backend 側からは削除し、agent 側にのみ置く (backend は
`mode` を意味解釈する必要がなくなったため)。`models.py` の `mode` フィールド
は `Literal["emergency","military","callcenter"]` で検証する。

### frontend

**削除:**
- `lib/realtime.ts` (OpenAI SDP exchange ロジック)
- `lib/tools.ts` (ブラウザ側の tool dispatcher)

**新規:**
- `lib/voice.ts` — agent の `/offer` と SDP を交換するだけの最小 WebRTC
  クライアント。DataChannel で受け取る `user_transcript` / `tool_call`
  / `order_persisted` を UI ステートに反映。

**維持:**
- QR ページ、OrderReceipt、OrderTicker、3 モード ルーティング、
  `/api/events` WS 購読。

**UI 変更点:** Push-to-Talk ボタン → 「AI が聞いています / 話しています」
インジケーターに置き換え (VAD 自動制御のため)。

## データフロー — 注文 1 件のライフサイクル

シナリオ: コールセンターモードで客が「親子丼を1つお願いします」と発話。

```
1.  Browser    Opus フレームを WebRTC で agent に送信
2.  agent      Silero VAD が speech-start を検知
3.  agent      VAD が silence 600ms → speech-end
4.  agent      faster-whisper → "親子丼を1つお願いします"
5.  agent      DC → Browser: {type:"user_transcript", text:"..."}
6.  agent      vLLM 呼び出し (system=callcenter persona + history + user)
7.  llm        tool_calls=[{name:"add_order",
                  args:{items:[{name:"親子丼",qty:1}], language:"ja"}}]
8.  agent      DC → Browser: {type:"tool_call", name:"add_order", args:{...}}
9.  agent      HTTP POST http://backend:8000/api/orders
                  → Sheets append → order_id 発行 → WS /api/events broadcast
                  ← {order_id:"ord_abc123", ...}
10. agent      conversation に tool_result を追加し vLLM 再呼び出し
11. llm        "親子丼を1つ承りました。10 分ほどお待ちください。"
12. agent      SBV2 TTS → Opus → WebRTC track → Browser スピーカー
13. agent      DC → Browser: {type:"order_persisted", order_id:"ord_abc123"}

並行: 別ブラウザの OrderTicker は step 9 の WS broadcast で即座に表示。
```

**設計上のポイント:**

- **tool 実行はサーバー側 (agent 内)** で完結。PR #105 では Browser が
  tool を実行していたが、自己ホストでは中継する理由がなく、レイテンシ
  と Browser 側コードの両方を削減。
- **DataChannel は UI 同期専用**。音声は audio track で別経路。
- **vLLM は 2 回呼ばれる** (tool_call 判定 → tool_result を含む最終
  応答生成)。2 回目は prefix キャッシュにより追加レイテンシは小さい
  (~200-400 ms)。
- **3 モードの差分は system prompt のみ**:
  - 🚑 emergency: 「これは救急通信センターです。要請内容を簡潔に確認します」
  - 🪖 military: 「作戦司令部です。報告を受領します。コールサインを発信してください」
  - ☎️ callcenter: 「○○食堂、ご注文承ります」(PR #105 と同等)
- **言語自動検出**: Whisper が ja/en/ko を検知し、同じ言語で LLM/TTS
  応答。ただし **TTS voice は ja のみ用意** し、en/ko 入力に対しても
  ja で応答する (Out of scope 参照)。

### レイテンシ予算

| 段階 | 目標値 |
|---|---|
| VAD speech-end → STT 完了 | 300 ms (faster-whisper medium) |
| LLM tool_call 判定 | 400 ms (Qwen 7B、短いプロンプト) |
| Backend Sheets write | 200 ms |
| LLM 最終応答 (first token) | 400 ms |
| TTS first chunk | 300 ms (SBV2 streaming) |
| **発話開始まで合計** | **~1.6 s** |

OpenAI Realtime (0.8-1.2 s) より遅いが、自己ホストデモとして許容範囲。

### GPU VRAM 予算 (L4 24 GB)

| コンポーネント | 概算 VRAM |
|---|---|
| vLLM (Qwen2.5-7B AWQ + KV 4k) | 9 GB |
| faster-whisper medium (fp16) | 2 GB |
| Style-BERT-VITS2 | 2 GB |
| **小計** | **13 GB** |
| 余裕 | 11 GB |

## エラーハンドリング

| 失敗 | UX | 処理 |
|---|---|---|
| GPU コールドスタート (vLLM 60s+) | QR スキャン後 503、進捗表示 | `/talk` ページが `/healthz` をポーリング、「音声エンジン準備中... 45 s」 |
| vLLM 5xx / OOM | 「AI 応答失敗」トースト | agent が 503 SDP answer、再試行ボタン。ログに OOM 印字 |
| Whisper の空 transcript | 「もう一度お願いします」発話 | 空 transcript 時は LLM をスキップし SBV2 で直接再要求 |
| Sheets API 失敗 | 「申し訳ありません、システムに記録できませんでした」と発話 | backend 500 → tool_result `{ok:false}` → LLM が定型謝罪。リトライキューは YAGNI |
| tool_call JSON パース失敗 | 一度だけ reprompt、それでも失敗なら平文応答 | Pydantic validate 失敗時に 1 回リトライ |
| WebRTC ICE 失敗 | 「接続できませんでした」表示 | STUN のみ。README で「企業 NAT では動かない場合あり」明記 |
| 同時接続多数 (QR 同時スキャン) | 6 人目から 503 + 案内 | agent の同時セッション cap = 5。vLLM continuous batching に依存 |
| セッション leak (タブ閉じ忘れ) | サーバー側で自動破棄 | aiortc の connectionstatechange 監視 + 5 分 idle timeout |

## セキュリティ

自己ホストにより、OpenAI 版で課題だった ephemeral token 流出やクォータ
浪費は消滅する。代わりに **GPU 資源浪費** が新しいリスクとなる。

**維持/導入する防御:**

1. **Origin allowlist** — agent と backend の両方で適用。`ALLOWED_ORIGINS`
   環境変数。PR #105 のパターンを踏襲。
2. **Per-IP rate limit on `/offer`** — agent 側で導入 (分間 3 回)。
   セッション自体が重いため OpenAI 版より厳しく。
3. **同時セッション上限** — agent が 5 セッション保持時に新規拒否。
4. **セッション最大時間** — 1 セッション 10 分の hard cap。
5. **`/api/orders` rate limit** — 新規追加。backend に汎用 IP rate limit
   ミドルウェアを導入し、分間 30 回。 PR #105 には `/api/orders` 用の
   rate limit が無かったため、ここで新設する。
6. **TLS** — `conoha-proxy` が ACME で終端。WebRTC 媒体は DTLS-SRTP。
7. **認証なし / PII 入力禁止** — デモ用途を明示。README に警告を追記。

**シークレット処理:**

- OpenAI キーは不要 (削除)。
- Google サービスアカウント JSON のみ残る。PR #105 で導入した sanitize
  ロジックは維持。
- HuggingFace トークンは Qwen2.5-7B-Instruct-AWQ では不要 (Apache 2.0、
  非 gated)。将来 gated モデルを使う場合のみ `HF_TOKEN` 対応を追加。

## テスト戦略

### Unit (CI、GPU 不要)

| 対象 | 方式 |
|---|---|
| `agent/tools.py` | `httpx` mock で backend レスポンス模擬 |
| `agent/personas.py` | 純粋関数、pytest |
| `agent/server.py` (Origin allowlist、rate limit、session cap) | FastAPI TestClient |
| `backend/` 既存テスト | PR #105 のテストを流用、`session_rate_limit` 削除分のみ手入れ |
| frontend `lib/voice.ts` | jsdom + `RTCPeerConnection` mock |

### Integration (ローカル docker compose、GPU 必要)

pytest marker `@pytest.mark.gpu` で分離:

| 対象 | 方式 |
|---|---|
| Pipecat e2e | 録音済み WAV を入力、出力 WAV キャプチャ → tool_call 発生 + transcript 一致を検証 |
| `/offer` SDP exchange | aiortc クライアントから実 PeerConnection、DC メッセージ 1 件受信 |
| Qwen2.5-7B tool_call 安定性 | 5 種類の発話 × 5 回 = 25 回、`add_order` 発火率 ≥ 90% |

### Smoke (デプロイ後、手動、GPU ノード)

- 各サービスの `/healthz`
- QR ページ 3 枚表示
- 各モードで「親子丼を1つ」発話 → Sheets 行追加
- 別ブラウザの OrderTicker 反映

### 意図的な YAGNI

- 音声品質の自動評価 (MOS など)
- 負荷テスト
- TURN サーバー
- カナリアデプロイ

## マイグレーション順序

PR #105 のコードは **再利用しない** (`voice-agent-conoha-l4/` は完全に
新規ディレクトリ)。ただし以下のファイルは検証済みのため PR #105 から
コピーする:

- `backend/app/routers/orders.py`
- `backend/app/routers/events.py`
- `backend/app/sheets.py`
- `backend/app/security.py` (`session_rate_limit` を除去し、`/api/orders`
  向け汎用 rate limit を新設)
- `backend/app/personas.py` → **agent/personas.py に移動** (backend では不要)
- `frontend/app/page.tsx`
- `frontend/components/OrderTicker.tsx`, `OrderReceipt.tsx`
- `frontend/app/layout.tsx` (description 文言のみ差し替え)

PR #105 で削除されるファイル (新サンプルにも持ち込まない):

- `backend/app/routers/realtime.py`
- `backend/app/tools_schema.py`
- `frontend/lib/realtime.ts`
- `frontend/lib/tools.ts`

実装ステップ:

1. **インフラ検証** — `g2l-t-c4m16g1-l4` 1 台で vLLM + Qwen2.5-7B-AWQ +
   SBV2 が単独で動くことを確認。モデル weight 用の永続ボリュームを作成。
2. **agent コンテナ骨格** — Pipecat パイプラインを mock service で
   組み立て、その後実サービスに置換。
3. **backend 簡素化** — PR #105 からコピー + realtime 系除去 + テスト通過。
4. **frontend `voice.ts`** — agent `/offer` のみ呼ぶ最小 WebRTC
   クライアント。PTT UI を VAD インジケーターに置換。
5. **e2e** — docker compose up、実マイクで検証。
6. **ConoHa デプロイ** — `conoha app init/deploy`、ACME 取得、スモーク
   テスト。
7. **README + spec 同期、PR 作成、PR #105 close** (コミットメッセージに
   「superseded by #NNN」)。

## 検討した代替案

| 案 | 採用しなかった理由 |
|---|---|
| LiveKit Agents | 1:1 音声デモには LiveKit SFU がオーバースペック。同等のコンポーネント構成を別途運用する手間が増える。 |
| End-to-end Moshi (Kyutai) | function calling 未対応のため本ユースケースに不向き。 |
| WebSocket + MediaRecorder (turn-based) | 実装は最も単純だが、自然な対話の体感が大きく劣化。デモのインパクトを損なう。 |
| Llama-3.1-8B-Instruct | 日本語の語調が Qwen より弱い。Qwen2.5-7B-AWQ が function calling と日本語の両方で安定。 |
| ELYZA-Llama-3-8B-JP | 日本語面談は強いが tool calling フォーマットの安定性が未検証。 |
| Fish-Speech | 日本語品質はやや劣る。Style-BERT-VITS2 がコミュニティ実績で優位。 |
| H100 (`g2l-t-c22m228g1-h100`) | デモ用途には過剰。L4 で十分な余裕がある。 |
| Push-to-talk (PR #105 と同じ) | VAD の方が体験が良く、Pipecat の標準パスでもある。 |

## Out of scope

- 認証 / ログイン (デモ用途のため、README で公開展開を禁止)
- 多言語 voice (TTS は ja のみ。en/ko 入力でも応答は ja)
- 通話録音保存
- 1 つの vLLM インスタンスでの複数モデルマルチテナント
- TURN サーバー / 企業 NAT 対応
- 運用メトリクスダッシュボード
- 自動スケーリング / GPU プール

## 環境変数

| 変数 | 説明 | 例 |
|---|---|---|
| `RESTAURANT_NAME` | AI 挨拶に差し込む店名 | `カフェ・コノハ` |
| `ALLOWED_ORIGINS` | カンマ区切りの許可オリジン | `https://voice-agent.example.com` |
| `OFFER_RATE_LIMIT_PER_MIN` | `/offer` の IP あたり毎分上限 | `3` |
| `MAX_CONCURRENT_SESSIONS` | agent の同時セッション数上限 | `5` |
| `SESSION_MAX_DURATION_SEC` | 1 セッションの最大秒数 | `600` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | サービスアカウント JSON (1 行) | (機密) |
| `SHEET_ID` | スプレッドシート ID | `1AbC...XyZ` |
| `LLM_MODEL` | vLLM がロードするモデル | `Qwen/Qwen2.5-7B-Instruct-AWQ` |
| `WHISPER_MODEL_SIZE` | faster-whisper サイズ | `medium` |
| `SBV2_MODEL_DIR` | SBV2 weight ディレクトリ | `/models/sbv2` |
| `BACKEND_URL` | agent → backend 内部 URL | `http://backend:8000` |
| `LLM_URL` | agent → llm 内部 URL | `http://llm:8000/v1` |

## 受け入れ基準

- ConoHa VPS3 (`g2l-t-c4m16g1-l4`) に `conoha app deploy` 1 コマンドで
  デプロイできる。
- ブラウザで `/` を開くと 3 枚の QR (emergency / military / callcenter)
  が表示される。
- 各モードで「親子丼を1つ」発話 → 2 秒以内に AI が応答開始し、
  Google Sheets に行が追加され、別ブラウザの OrderTicker に反映される。
- `/offer` を許可外 Origin から呼ぶと 403、許可 Origin から分間 3 回
  超で 429。
- 同時セッションが 6 人目から 503 になる。
- OpenAI への外部通信が一切発生しない (`tcpdump` で確認可能)。
- スペック内の全 unit テストが CI で通過する。
