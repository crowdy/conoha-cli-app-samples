# vllm-gpu

Deploy an **OpenAI-compatible LLM inference server** on an NVIDIA L4 GPU flavor using [vLLM](https://github.com/vllm-project/vllm). Caddy fronts the service with optional automatic HTTPS, so you can hit `/v1/chat/completions` and other OpenAI-compatible endpoints directly.

## How this sample compares

| Sample | Audience | API | Concurrency |
|---|---|---|---|
| [`ollama-webui-gpu`](../ollama-webui-gpu/) | End users | Ollama-native + WebUI | Serialized |
| **`vllm-gpu` (this sample)** | Backend developers | OpenAI-compatible `/v1/*` | Batched via PagedAttention |

## Components

| Service | Port | Purpose |
|---|---|---|
| vLLM | 8000 (internal) | OpenAI-compatible inference server |
| Caddy | 80, 443 | HTTPS termination + reverse proxy |

## Prerequisites

- [conoha-cli](https://github.com/crowdy/conoha-cli) installed
- ConoHa VPS3 account + SSH keypair
- An **L4 GPU flavor** (`g2l-*-l4` family)
- NVIDIA driver ≥ 535, CUDA ≥ 12.1

## GPU setup

Same procedure as `ollama-webui-gpu`:

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

# Step 3: Reboot
sudo reboot

# Step 4: Verify
sudo apt install -y nvidia-utils-570-server
nvidia-smi
```

## Deploy

```bash
# Create the server
conoha server add --flavor g2l-t-c20m128g1-l4 --image ubuntu-24.04 \
  --key mykey --name vllm-gpu

# Run the GPU setup above.

# Initialize the app
conoha app init vllm-gpu --app-name vllm-gpu \
  --identity ~/.ssh/conoha_mykey --no-input

# Deploy (first run takes 5–20 min for model download; healthcheck start_period=1200s)
conoha app deploy vllm-gpu --app-name vllm-gpu \
  --identity ~/.ssh/conoha_mykey --no-input
```

## Verify

```bash
# On the server
docker compose ps      # vllm: healthy / caddy: running

# From your laptop
BASE_URL=http://<server-ip> bash scripts/smoke-test.sh
# → [1/3] ok / [2/3] ok / [3/3] ok
# → All 3 endpoints responded successfully.
```

OpenAI SDK works as-is:

```python
from openai import OpenAI
client = OpenAI(base_url="http://<server-ip>/v1", api_key="<VLLM_API_KEY or empty>")
r = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "Hello"}],
)
print(r.choices[0].message.content)
```

## Benchmark

```bash
BASE_URL=http://<server-ip> bash scripts/benchmark.sh
```

Measured on a single L4 24GB running `Qwen2.5-7B-Instruct-AWQ` (reference, to be updated):

| Metric | Value |
|---|---|
| Single-request throughput | TBD tok/s |
| 16-concurrent aggregate | TBD tok/s |
| TTFT p50 | TBD ms |
| TPOT p50 | TBD ms |

## Customization

### Switch model

Toggle `MODEL_NAME` in `.env`:

```bash
# Light + fast
MODEL_NAME=Qwen/Qwen2.5-7B-Instruct-AWQ

# Higher quality, less KV-cache headroom
MODEL_NAME=Qwen/Qwen2.5-32B-Instruct-AWQ
```

### Enable HTTPS

Point `vllm.example.com` to your server's IP in DNS, then in `.env`:

```bash
DOMAIN_NAME=vllm.example.com
```

Caddy will fetch a Let's Encrypt cert automatically.

### Protect with an API key

```bash
VLLM_API_KEY=$(openssl rand -hex 32)
```

After this, every `/v1/*` request must include `Authorization: Bearer <key>`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `CUDA out of memory` | Lower `MAX_MODEL_LEN` (8192→4096) or `GPU_MEMORY_UTILIZATION` to 0.85 |
| `model not found` | Gated HF models (Llama family) require `HF_TOKEN` |
| AWQ kernel error | Switch to `QUANTIZATION=awq` (Marlin fallback for older GPUs) |
| `nvidia-smi` not found | Run Step 4 — install `nvidia-utils-570-server` |
| Healthcheck failing on restart loop | First-run model download still in progress. Tail `docker compose logs vllm` and wait up to 20 min. |

## Related

- [vLLM upstream](https://github.com/vllm-project/vllm)
- [Qwen2.5 models](https://huggingface.co/Qwen)
- [`ollama-webui-gpu`](../ollama-webui-gpu/) (per-user chat UI variant)
- [`fish-speech-tts-gpu`](../fish-speech-tts-gpu/) (TTS on the same L4)
