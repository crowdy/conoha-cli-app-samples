# vllm-gpu

NVIDIA L4 GPU 플레이버에 [vLLM](https://github.com/vllm-project/vllm) 기반 **OpenAI 호환 LLM 추론 서버**를 배포하는 샘플. Caddy 리버스 프록시를 통해 `/v1/chat/completions` 등의 OpenAI 호환 API를 그대로 사용할 수 있습니다.

## 이 샘플의 위치

| 샘플 | 대상 사용자 | API | 동시 처리 |
|---|---|---|---|
| [`ollama-webui-gpu`](../ollama-webui-gpu/) | 엔드유저 | Ollama 자체 + WebUI | 직렬 |
| **`vllm-gpu` (본 샘플)** | 백엔드 개발자 | OpenAI 호환 `/v1/*` | PagedAttention 배치 처리 |

## 구성

| 서비스 | 포트 | 설명 |
|---|---|---|
| vLLM | 8000 (내부 전용) | OpenAI 호환 추론 서버 |
| Caddy | 80, 443 | HTTPS 종단·리버스 프록시 |

## 사전 요건

- [conoha-cli](https://github.com/crowdy/conoha-cli) 설치
- ConoHa VPS3 계정 + SSH 키페어
- **L4 GPU 플레이버** (`g2l-*-l4` 계열)
- NVIDIA 드라이버 535 이상 / CUDA 12.1 이상

## GPU 환경 설정

`ollama-webui-gpu` 등과 동일한 절차입니다.

```bash
# Step 1: NVIDIA Container Toolkit
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Step 2: NVIDIA Driver
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu

# Step 3: 재부팅
sudo reboot

# Step 4: 확인
sudo apt install -y nvidia-utils-570-server
nvidia-smi
```

## 배포

```bash
# 서버 생성
conoha server add --flavor g2l-t-c20m128g1-l4 --image ubuntu-24.04 \
  --key mykey --name vllm-gpu

# 위의 GPU 셋업 진행

# 배포 (첫 실행 시 모델 다운로드로 5–20분 소요. healthcheck start_period=1200초)
# Caddy가 80/443을 직접 공개하므로 conoha-proxy 경유 blue/green 배치를 위한
# `conoha app init`은 사용하지 않고, `conoha app deploy`만으로 운용합니다.
conoha app deploy vllm-gpu --app-name vllm-gpu \
  --identity ~/.ssh/conoha_mykey --no-input
```

## 동작 확인

```bash
# 서버 측에서
docker compose ps      # vllm: healthy / caddy: running

# 로컬에서
BASE_URL=http://<서버IP> bash scripts/smoke-test.sh
# → [1/3] ok / [2/3] ok / [3/3] ok
```

OpenAI SDK도 그대로 사용 가능:

```python
from openai import OpenAI
client = OpenAI(base_url="http://<서버IP>/v1", api_key="<VLLM_API_KEY 또는 empty>")
r = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "안녕하세요"}],
)
print(r.choices[0].message.content)
```

## 벤치마크

```bash
BASE_URL=http://<서버IP> bash scripts/benchmark.sh
```

L4 24GB 단일 GPU에서 `Qwen2.5-7B-Instruct-AWQ` 실측값 (참고, 갱신 예정):

| 지표 | 값 |
|---|---|
| 단일 요청 처리량 | TBD tok/s |
| 동시 16 요청 합산 | TBD tok/s |
| TTFT p50 | TBD ms |
| TPOT p50 | TBD ms |

## 커스터마이즈

### 모델 변경

`.env`의 `MODEL_NAME` 주석을 전환:

```bash
# 가벼움·빠름
MODEL_NAME=Qwen/Qwen2.5-7B-Instruct-AWQ

# 고품질·KV 캐시 여유 적음
MODEL_NAME=Qwen/Qwen2.5-32B-Instruct-AWQ
```

### HTTPS 활성화

DNS에서 `vllm.example.com`을 서버 IP에 연결하고 `.env`에:

```bash
DOMAIN_NAME=vllm.example.com
```

Caddy가 자동으로 Let's Encrypt 인증서를 발급합니다.

### API 키로 보호

```bash
VLLM_API_KEY=$(openssl rand -hex 32)
```

이후 `/v1/*` 모든 요청에 `Authorization: Bearer <key>` 가 필수가 됩니다.

## 트러블슈팅

| 증상 | 대처 |
|---|---|
| `CUDA out of memory` | `MAX_MODEL_LEN`을 줄임(8192→4096) 또는 `GPU_MEMORY_UTILIZATION`을 0.85로 |
| `model not found` | HF gated 모델(Llama 등)은 `HF_TOKEN` 필요 |
| AWQ kernel 에러 | `QUANTIZATION=awq`로 전환(구형 GPU 폴백) |
| `nvidia-smi` 없음 | Step 4의 `nvidia-utils-570-server` 설치 실행 |
| 헬스체크 실패 재시작 루프 | 첫 모델 DL 진행 중. `docker compose logs vllm`로 확인하고 20분 대기 |

## 관련 링크

- [vLLM 공식](https://github.com/vllm-project/vllm)
- [Qwen2.5 모델](https://huggingface.co/Qwen)
- [`ollama-webui-gpu`](../ollama-webui-gpu/) (개인용 채팅 UI 버전)
- [`fish-speech-tts-gpu`](../fish-speech-tts-gpu/) (동일 L4에서 TTS)
