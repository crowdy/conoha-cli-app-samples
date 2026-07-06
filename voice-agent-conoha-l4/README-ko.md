# voice-agent-conoha-l4

ConoHa VPS3 L4 GPU 위에 **자체 호스팅 음성 에이전트**를 구축하는 샘플.
브라우저에서 QR을 스캔하는 것만으로 AI와 음성 대화가 가능하며, 대화 내용이
Google Sheets에 실시간으로 업무 데이터로 기록된다. OpenAI 등 외부 AI 서비스로의
통신은 **일체 없음**.

`voice-agent-webrtc-realtime` (OpenAI Realtime API 의존)의 후계 버전. 동일한
유스케이스·3가지 모드의 「○○식당 주문 접수 AI」를 자체 호스팅 구성으로 실현한다.

## 구성

| 레이어 | 기술 |
|---|---|
| 프론트엔드 | Next.js 16 (App Router, standalone) |
| 음성 AI 에이전트 | Pipecat + aiortc + Silero VAD |
| STT | faster-whisper (medium, ja/en/ko 자동) |
| LLM | vLLM + Qwen/Qwen2.5-7B-Instruct-AWQ (function calling) |
| TTS | Style-BERT-VITS2 (jvnv 계열) |
| 백엔드 | FastAPI — 주문 API + Google Sheets + WS broadcast |
| GPU | NVIDIA L4 24GB (`g2l-t-c4m16g1-l4`) |

설계 상세: [`docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md`](../docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md)

## 사전 요구사항

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.8.0`
- ConoHa VPS3 계정, SSH 키 페어
- 자신이 관리하는 DNS에서 FQDN을 하나 준비할 수 있을 것
- Google 서비스 계정과 공유된 스프레드시트

## 환경 변수

`.env.example`을 복사해 `.env`를 만들고 값을 채운다. 자세한 내용은 `.env.example`의
주석 참조. 최소한 필요한 항목:

| 변수 | 설명 |
|---|---|
| `PUBLIC_BASE_URL` | 배포 대상 FQDN (HTTPS) |
| `ALLOWED_ORIGINS` | `PUBLIC_BASE_URL`과 동일 |
| `SHEET_ID` | 스프레드시트 ID |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | 서비스 계정 JSON을 한 줄로 |

## 배포 절차

```bash
# 1. GPU VPS 생성
conoha server create --name voice-agent-l4 --flavor g2l-t-c4m16g1-l4 \
    --image ubuntu-24.04 --key <ssh-key>

# 2. 출력된 IP에 DNS A 레코드를 설정하고 전파를 기다린다
dig +short voice-agent.example.com    # IP와 일치할 때까지 대기

# 3. conoha-proxy 기동 (ACME)
conoha proxy boot --acme-email you@example.com voice-agent-l4

# 4. conoha.yml의 `hosts:`를 자신의 FQDN으로 바꾼다

# 5. 앱 초기화 (Docker volume 생성)
cd voice-agent-conoha-l4
conoha app init voice-agent-l4

# 6. SBV2 weights를 사전 배치 (최초 1회만, volume 생성 후)
ssh root@<vps> 'bash -s' < voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh

# 7. 배포 (최초는 GPU image pull + 모델 다운로드로 10-15분)
conoha app deploy voice-agent-l4

# 8. /healthz가 200을 반환하면 기동 완료 (모델 warmup 90-120s)
curl https://voice-agent.example.com/healthz
```

## 스모크 테스트

```bash
# 주문 POST
ORDER=$(curl -fsS -X POST https://voice-agent.example.com/api/orders \
  -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
  -d '{"mode":"callcenter","language":"ja","items":[{"name":"スモークラーメン","qty":1}]}')
OID=$(echo "$ORDER" | jq -r .order_id)

# 업데이트
curl -fsS -X PATCH https://voice-agent.example.com/api/orders/$OID \
  -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
  -d '{"items":[{"name":"スモークラーメン","qty":2}],"notes":"smoke"}' | jq .

# Origin 거부 확인
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://voice-agent.example.com/api/offer \
  -H "Origin: https://evil.example.com" \
  -H "Content-Type: application/json" \
  -d '{"sdp":"x","type":"offer","mode":"callcenter"}'
# 기대: 403
```

QR 스캔 → `/talk?mode=...`에서 「親子丼を1つ」 같은 짧은 발화 → 약 2초 후
AI 응답 → Sheets에 행 추가, 다른 브라우저의 OrderTicker에 반영.

## ⚠️ 보안 주의사항

- `ALLOWED_ORIGINS`를 자신의 FQDN으로 설정한다. 비워두면 임의의 사이트에서
  `/offer`를 호출해 GPU 자원이 소비될 수 있다.
- `OFFER_RATE_LIMIT_PER_MIN` 기본값 3, `MAX_CONCURRENT_SESSIONS` 기본값 5.
  공개 데모는 신중하게.
- 인증이 걸려 있지 않다. 본격적인 고객 향 배포에는 별도 인증 흐름이 필요.
- 음성 통화 내용은 Sheets에 기록된다. **개인정보는 입력하지 말 것**.

## 검토 경위

OpenAI Realtime API 기반 샘플 (`voice-agent-webrtc-realtime`)을 출발점으로 하면서,
GMO 내부의 OpenAI 이용 제한을 받아 외부 AI 의존을 배제하는 구성으로 본 샘플이
만들어졌다. 대안으로 LiveKit Agents나 end-to-end Moshi를 검토했지만, Pipecat 기반
STT+LLM+TTS 파이프라인이 기존 샘플 (`vllm-gpu`, `fish-speech-tts-gpu`)과 패턴을
맞추기 쉬워 채택했다.
