#!/bin/sh
set -eu
SRC="${SOURCE_KUBECONFIG:-/output/kubeconfig.yaml}"
echo "[api] waiting for kubeconfig at $SRC ..."
while [ ! -f "$SRC" ]; do sleep 2; done
exec uvicorn app.main:app --host 0.0.0.0 --port 8080
