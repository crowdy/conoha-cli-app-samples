#!/usr/bin/env bash
set -euo pipefail

exec python3 -m vllm.entrypoints.openai.api_server \
  --host 0.0.0.0 \
  --port 8000 \
  --model "${LLM_MODEL}" \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --quantization awq_marlin \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
