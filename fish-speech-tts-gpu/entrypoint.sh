#!/bin/bash
set -e

MODEL_DIR="/app/checkpoints/s2-pro"
MARKER_FILE="$MODEL_DIR/codec.pth"

# Download model only if not already present
if [ ! -f "$MARKER_FILE" ]; then
    echo "=== Downloading Fish Speech s2-pro model ==="
    huggingface-cli download fishaudio/s2-pro --local-dir "$MODEL_DIR"
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

# Start WebUI in foreground
echo "=== Starting WebUI on port 7860 ==="
exec python tools/run_webui.py
