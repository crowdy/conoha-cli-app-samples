#!/usr/bin/env bash
set -euo pipefail

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

MODEL_REPO="${MODEL_REPO:-tencent/Hunyuan3D-2}"
MODEL_DIR="${HF_HOME:-/root/.cache/huggingface}/hub/models--${MODEL_REPO//\//--}"
SENTINEL="$MODEL_DIR/.download_complete"

mkdir -p /app/outputs "$MODEL_DIR"

if [ ! -f "$SENTINEL" ]; then
    log "Downloading model weights: $MODEL_REPO (~10GB, first boot only)"
    huggingface-cli download "$MODEL_REPO"
    touch "$SENTINEL"
    log "Model download complete"
else
    log "Model weights cache hit, skipping download"
fi

log "GPU info:"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader || true

log "Starting Hunyuan3D-2 Gradio app on 0.0.0.0:7860"
exec python3 gradio_app.py --host 0.0.0.0 --port 7860 --cache-path /app/outputs
