#!/usr/bin/env bash
# ローカル実行される共有ヘルパ。VM 上では使わない（bootstrap/agent は自己完結）。
set -uo pipefail

die() { echo "[buzz] ERROR: $*" >&2; exit 1; }
log() { echo "[buzz] $*" >&2; }

# stdin の `conoha server show --format json` から公開 IPv4 を 1 個。無ければ空。
# addresses はネットワーク名キーの dict、値は {addr,version} のリスト（memory 準拠）。
pubip() {
  python3 -c '
import json,sys
d=json.load(sys.stdin)
def public(ip):
    if ip.startswith(("10.","127.","192.168.")): return False
    if ip.startswith("172."):
        o=int(ip.split(".")[1]); return not (16<=o<=31)
    return True
ips=[a["addr"] for net in d.get("addresses",{}).values()
     for a in net if a.get("version")==4 and public(a["addr"])]
print(ips[0] if ips else "")'
}

ip_to_dashes() { printf '%s' "$1" | tr '.' '-'; }

load_ref() {
  local ref="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.buzz-ref}"
  [ -f "$ref" ] || die ".buzz-ref not found at $ref"
  # shellcheck source=/dev/null
  . "$ref"
  [ -n "${BUZZ_GIT_REF:-}" ] || die "BUZZ_GIT_REF unset in .buzz-ref"
  [ -n "${BUZZ_IMAGE:-}" ]   || die "BUZZ_IMAGE unset in .buzz-ref"
  export BUZZ_GIT_REF BUZZ_IMAGE
}

# 検証済み先例（vcluster）と同じく conoha server ssh を使う（key 自動検出）。SERVER はグローバル。
ssh_vm()   { conoha server ssh "${SERVER:?SERVER unset}" -- "$@"; }
put_file() { conoha server ssh "${SERVER:?SERVER unset}" -- "cat > $2" < "$1"; }
