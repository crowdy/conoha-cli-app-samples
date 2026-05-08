#!/usr/bin/env bash
# Benchmark wrapper for vllm-gpu sample.
# Runs vLLM's built-in benchmark_serving against the deployed server
# and prints throughput / latency stats (TTFT, TPOT, p50/p99).
#
# Usage:
#   NUM_PROMPTS=200 REQUEST_RATE=8 bash scripts/benchmark.sh
#
# This runs `vllm.benchmarks.serve` *inside* the vllm container via
# `docker compose exec`, so BASE_URL defaults to vllm's own listener
# (http://localhost:8000) — bypassing Caddy to measure raw inference.
# Defaults are tuned for a single L4 24GB running Qwen 7B AWQ.
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
NUM_PROMPTS="${NUM_PROMPTS:-200}"
REQUEST_RATE="${REQUEST_RATE:-8}"
INPUT_LEN="${INPUT_LEN:-512}"
OUTPUT_LEN="${OUTPUT_LEN:-256}"

echo "Benchmark target: ${BASE_URL}"
echo "  num_prompts=${NUM_PROMPTS}  request_rate=${REQUEST_RATE} req/s"
echo "  input_len=${INPUT_LEN}      output_len=${OUTPUT_LEN}"
echo

docker compose exec -T vllm \
  python -m vllm.benchmarks.serve \
    --backend openai \
    --base-url "${BASE_URL}" \
    --model default \
    --dataset-name random \
    --num-prompts "${NUM_PROMPTS}" \
    --request-rate "${REQUEST_RATE}" \
    --random-input-len "${INPUT_LEN}" \
    --random-output-len "${OUTPUT_LEN}"
