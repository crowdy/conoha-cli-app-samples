#!/usr/bin/env bash
# voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh
#
# One-shot helper: download a default SBV2 Japanese voice into the `models`
# named volume so the agent container can use it on first boot.
# Run on the ConoHa host after `conoha app init` but before `conoha app deploy`.
set -euo pipefail

VOLUME=$(docker volume ls -qf name=voice-agent-conoha-l4_models-agent | head -1)
if [ -z "$VOLUME" ]; then
  echo "models-agent volume not found. Run 'docker compose up backend' once to create it." >&2
  exit 1
fi

TARGET="/var/lib/docker/volumes/${VOLUME}/_data/sbv2"
mkdir -p "$TARGET"

# litagin/style_bert_vits2_jvnv has a permissively-licensed voice.
git clone --depth=1 https://huggingface.co/litagin/style_bert_vits2_jvnv "$TARGET"

echo "SBV2 weights placed at $TARGET"
