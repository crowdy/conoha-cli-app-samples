#!/bin/bash
set -eu

MODEL_DIR="/app/checkpoints/s2-pro"
SENTINEL_FILE="$MODEL_DIR/.download_complete"

# Download model only if not already present
if [ ! -f "$SENTINEL_FILE" ]; then
    echo "=== Downloading Fish Speech s2-pro model ==="
    rm -rf "$MODEL_DIR"
    huggingface-cli download fishaudio/s2-pro --local-dir "$MODEL_DIR"
    touch "$SENTINEL_FILE"
    echo "=== Model download complete ==="
else
    echo "=== Model already exists, skipping download ==="
fi

# Start API server in background
echo "=== Starting API server on port 8080 ==="
python tools/api_server.py \
    --listen 0.0.0.0:8080 \
    --llama-checkpoint-path "$MODEL_DIR" \
    --decoder-checkpoint-path "$MODEL_DIR/codec.pth" \
    --decoder-config-name modded_dac_vq \
    --device cuda \
    ${COMPILE:+--compile} &
API_PID=$!

# Verify API server started successfully
sleep 5
if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "=== ERROR: API server failed to start ===" >&2
    exit 1
fi

# Start WebUI in foreground
echo "=== Starting WebUI on port 7860 ==="
exec python tools/run_webui.py
