#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p src/types
npx openapi-typescript specs/messaging-api.yml -o src/types/line-api.d.ts
