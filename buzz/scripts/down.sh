#!/usr/bin/env bash
# 全 buzz-sample リソースを破棄。冪等（無ければ無視）。時間課金を止める安全網。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
SERVER="${1:-buzz-sample}"
SG="${SERVER}-sg"

log "deleting server ${SERVER} (with boot volume)..."
conoha server delete "$SERVER" --delete-boot-volume --yes 2>&1 | tail -1 || true

log "deleting security-group ${SG} (best-effort)..."
conoha network security-group delete "$SG" --yes 2>/dev/null || true

# keypair は削除しない（reviewer N1）: up.sh は登録済み KEY_NAME を再利用し
# キーペアを作らないため、ここで消すと利用者の登録鍵を破壊する。
log "keypair は保持（up.sh は登録済みキーを再利用するため削除しない）"

log "remaining ${SERVER}* servers:"
conoha server list 2>/dev/null | grep -E "\b${SERVER}\b" || log "  (none)"
