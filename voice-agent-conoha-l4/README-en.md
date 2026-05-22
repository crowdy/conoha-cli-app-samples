# voice-agent-conoha-l4

A sample for building a **self-hosted voice agent** on ConoHa VPS3 L4 GPU.
Scanning a QR code with your browser is all it takes to start a voice conversation
with the AI, and the conversation content is written to Google Sheets in real time
as operational data. **No communication** with external AI services such as OpenAI.

Successor to `voice-agent-webrtc-realtime` (which depends on the OpenAI Realtime
API). Achieves the same use case — a 3-mode "restaurant order-taking AI" — in a
self-hosted configuration.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, standalone) |
| Voice AI agent | Pipecat + aiortc + Silero VAD |
| STT | faster-whisper (medium, auto ja/en/ko) |
| LLM | vLLM + Qwen/Qwen2.5-7B-Instruct-AWQ (function calling) |
| TTS | Style-BERT-VITS2 (jvnv series) |
| Backend | FastAPI — orders API + Google Sheets + WS broadcast |
| GPU | NVIDIA L4 24GB (`g2l-t-c4m16g1-l4`) |

Design details: [`docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md`](../docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md)

## Prerequisites

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.8.0`
- ConoHa VPS3 account, SSH key pair
- Ability to provision one FQDN in a DNS zone you control
- Google service account and a shared spreadsheet

## Environment Variables

Copy `.env.example` to `.env` and fill in the values. See the comments in
`.env.example` for details. The minimum required variables are:

| Variable | Description |
|---|---|
| `PUBLIC_BASE_URL` | Deployment FQDN (HTTPS) |
| `ALLOWED_ORIGINS` | Same as `PUBLIC_BASE_URL` |
| `SHEET_ID` | Spreadsheet ID |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Service account JSON on a single line |

## Deployment Steps

```bash
# 1. Create GPU VPS
conoha server create --name voice-agent-l4 --flavor g2l-t-c4m16g1-l4 \
    --image ubuntu-24.04 --key <ssh-key>

# 2. Set a DNS A record pointing to the output IP, then wait for propagation
dig +short voice-agent.example.com    # wait until it matches the IP

# 3. Start conoha-proxy (ACME)
conoha proxy boot --acme-email you@example.com voice-agent-l4

# 4. Replace `hosts:` in conoha.yml with your own FQDN

# 5. Initialize the app (creates Docker volume)
cd voice-agent-conoha-l4
conoha app init voice-agent-l4

# 6. Pre-stage SBV2 weights (first time only, after volume creation)
ssh root@<vps> 'bash -s' < voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh

# 7. Deploy (first run takes 10-15 min for GPU image pull + model download)
conoha app deploy voice-agent-l4

# 8. When /healthz returns 200 the service is ready (model warmup 90-120s)
curl https://voice-agent.example.com/healthz
```

## Smoke Tests

```bash
# POST an order
ORDER=$(curl -fsS -X POST https://voice-agent.example.com/api/orders \
  -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
  -d '{"mode":"callcenter","language":"ja","items":[{"name":"スモークラーメン","qty":1}]}')
OID=$(echo "$ORDER" | jq -r .order_id)

# Update the order
curl -fsS -X PATCH https://voice-agent.example.com/api/orders/$OID \
  -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
  -d '{"items":[{"name":"スモークラーメン","qty":2}],"notes":"smoke"}' | jq .

# Verify Origin rejection
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://voice-agent.example.com/api/offer \
  -H "Origin: https://evil.example.com" \
  -H "Content-Type: application/json" \
  -d '{"sdp":"x","type":"offer","mode":"callcenter"}'
# Expected: 403
```

Scan QR → speak a short utterance at `/talk?mode=...` such as 「親子丼を1つ」 →
AI responds in ~2 seconds → a row appears in Sheets and the OrderTicker in another
browser tab updates.

## ⚠️ Security Notes

- Set `ALLOWED_ORIGINS` to your own FQDN. Leaving it empty allows any site to call
  `/offer` and consume your GPU resources.
- `OFFER_RATE_LIMIT_PER_MIN` defaults to 3; `MAX_CONCURRENT_SESSIONS` defaults to 5.
  Be cautious with public demos.
- There is no authentication. A proper auth flow is required for production
  customer-facing deployments.
- Voice call content is written to Sheets. **Do not enter personal information.**

## Background

This sample was created starting from the OpenAI Realtime API-based sample
(`voice-agent-webrtc-realtime`) and removing all external AI dependencies in
response to GMO's internal restrictions on OpenAI usage. LiveKit Agents and
end-to-end Moshi were considered as alternatives, but the Pipecat-based
STT+LLM+TTS pipeline was chosen because it aligns well with the patterns already
established in existing samples (`vllm-gpu`, `fish-speech-tts-gpu`).
