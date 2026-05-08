#!/usr/bin/env bash
# Smoke test for vllm-gpu sample.
# Verifies that the deployed vLLM server responds to:
#   1. GET  /v1/models
#   2. POST /v1/chat/completions
#   3. POST /v1/completions
#
# Usage:
#   BASE_URL=http://<server-ip> [VLLM_API_KEY=xxx] bash scripts/smoke-test.sh
#
# Run from your laptop (or the server). BASE_URL must reach the Caddy
# port 80/443; from the server itself, http://localhost works.
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
API_KEY="${VLLM_API_KEY:-}"

if [[ -n "$API_KEY" ]]; then
  AUTH=(-H "Authorization: Bearer ${API_KEY}")
else
  AUTH=()
fi

# --max-time guards against a wedged server (mid-warmup, hung CUDA, OOM).
CURL=(curl -fsS --max-time 60)

echo "[1/3] GET ${BASE_URL}/v1/models"
"${CURL[@]}" "${AUTH[@]}" "${BASE_URL}/v1/models" \
  | jq -e '.data[0].id == "default"' > /dev/null
echo "  ok"

echo "[2/3] POST ${BASE_URL}/v1/chat/completions"
"${CURL[@]}" -X POST "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  "${BASE_URL}/v1/chat/completions" \
  -d '{"model":"default","messages":[{"role":"user","content":"Say hi in one word."}],"max_tokens":16}' \
  | jq -e '.choices[0].message.content | type == "string" and length > 0' > /dev/null
echo "  ok"

echo "[3/3] POST ${BASE_URL}/v1/completions"
"${CURL[@]}" -X POST "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  "${BASE_URL}/v1/completions" \
  -d '{"model":"default","prompt":"The capital of Japan is","max_tokens":8}' \
  | jq -e '.choices[0].text | type == "string" and length > 0' > /dev/null
echo "  ok"

echo
echo "All 3 endpoints responded successfully."
