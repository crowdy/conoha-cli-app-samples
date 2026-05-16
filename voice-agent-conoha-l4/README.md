# voice-agent-conoha-l4

ConoHa VPS3 L4 GPU 上に **自己ホストの音声エージェント** を構築するサンプル。
ブラウザで QR を撮るだけで AI と音声会話ができ、会話の内容が Google Sheets
にリアルタイムで業務データとして書き込まれる。OpenAI など外部 AI サービス
への通信は**一切なし**。

`voice-agent-webrtc-realtime` (OpenAI Realtime API 依存) の後継。同じ
ユースケース・3 モードの「○○食堂の注文受付 AI」を自己ホスト構成で実現する。

## 構成

| レイヤー | 技術 |
|---|---|
| フロント | Next.js 16 (App Router, standalone) |
| 音声 AI agent | Pipecat + aiortc + Silero VAD |
| STT | faster-whisper (medium, ja/en/ko 自動) |
| LLM | vLLM + Qwen/Qwen2.5-7B-Instruct-AWQ (function calling) |
| TTS | Style-BERT-VITS2 (jvnv 系) |
| バックエンド | FastAPI — 注文 API + Google Sheets + WS broadcast |
| GPU | NVIDIA L4 24GB (`g2l-t-c4m16g1-l4`) |

設計詳細: [`docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md`](../docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md)

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.8.0`
- ConoHa VPS3 アカウント、SSH キーペア
- 自分の制御下の DNS で FQDN を 1 つ用意できる
- Google サービスアカウントと共有済みスプレッドシート

## 環境変数

`.env.example` をコピーして `.env` を作成し値を埋める。詳細は `.env.example`
のコメントを参照。最低限必要:

| 変数 | 説明 |
|---|---|
| `PUBLIC_BASE_URL` | デプロイ先 FQDN (HTTPS) |
| `ALLOWED_ORIGINS` | `PUBLIC_BASE_URL` と同じ |
| `SHEET_ID` | スプレッドシート ID |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | サービスアカウント JSON を 1 行で |

## デプロイ手順

```bash
# 1. GPU VPS を作成
conoha server create --name voice-agent-l4 --flavor g2l-t-c4m16g1-l4 \
    --image ubuntu-24.04 --key <ssh-key>

# 2. 出力された IP に DNS A レコードを設定し、伝播を待つ
dig +short voice-agent.example.com    # IP と一致まで待機

# 3. conoha-proxy 起動 (ACME)
conoha proxy boot --acme-email you@example.com voice-agent-l4

# 4. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 5. SBV2 weights を事前配置 (初回のみ)
ssh root@<vps> 'bash -s' < voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh

# 6. デプロイ (初回は GPU image pull + モデルダウンロードで 10-15 分)
cd voice-agent-conoha-l4
conoha app init voice-agent-l4
conoha app deploy voice-agent-l4

# 7. /healthz が 200 を返したら起動完了 (モデル warmup 90-120s)
curl https://voice-agent.example.com/healthz
```

## スモークテスト

```bash
# 注文 POST
ORDER=$(curl -fsS -X POST https://voice-agent.example.com/api/orders \
  -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
  -d '{"mode":"callcenter","language":"ja","items":[{"name":"スモークラーメン","qty":1}]}')
OID=$(echo "$ORDER" | jq -r .order_id)

# 更新
curl -fsS -X PATCH https://voice-agent.example.com/api/orders/$OID \
  -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
  -d '{"items":[{"name":"スモークラーメン","qty":2}],"notes":"smoke"}' | jq .

# Origin 拒否確認
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://voice-agent.example.com/api/offer \
  -H "Origin: https://evil.example.com" \
  -H "Content-Type: application/json" \
  -d '{"sdp":"x","type":"offer","mode":"callcenter"}'
# 期待: 403
```

QR スキャン → `/talk?mode=...` で「親子丼を1つ」のような短い発話 → 約 2 秒で
AI が応答 → Sheets に行追加・別ブラウザの OrderTicker に反映。

## ⚠️ セキュリティ上の注意

- `ALLOWED_ORIGINS` を自分の FQDN に設定する。空のままだと任意のサイトから
  `/offer` を呼び出されて GPU 資源が消費される。
- `OFFER_RATE_LIMIT_PER_MIN` 既定 3、`MAX_CONCURRENT_SESSIONS` 既定 5。
  公開デモは慎重に。
- 認証はかかっていない。本格的な顧客向け展開には別途認証フローが必要。
- 音声通話の内容は Sheets に書き込まれる。**個人情報は入力しないこと**。

## 検討の経緯

OpenAI Realtime API ベースのサンプル (`voice-agent-webrtc-realtime`) を出発
点にしつつ、GMO 内部での OpenAI 利用制限を受けて、外部 AI 依存を排除する
構成として本サンプルが作られた。代替案として LiveKit Agents や end-to-end
Moshi を検討したが、Pipecat ベースの STT+LLM+TTS パイプラインが既存サンプル
(`vllm-gpu`, `fish-speech-tts-gpu`) とパターンを揃えやすく採用した。
