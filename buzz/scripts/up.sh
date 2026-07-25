#!/usr/bin/env bash
# ConoHa VPS 1 台に Buzz リレーを立てる。冪等ではない（既存なら down.sh を先に）。
# 時間課金 → 使い終わったら必ず ./down.sh。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
load_ref
SERVER="${SERVER:-buzz-sample}"; SG="${SERVER}-sg"
KEY_NAME="${KEY_NAME:?set KEY_NAME to a registered keypair (conoha keypair list)}"
FLAVOR="${FLAVOR:-g2l-t-c6m8}"
SECRETS="$HERE/../.secrets"; mkdir -p "$SECRETS"; chmod 700 "$SECRETS"

log "1. security-group（keypair は登録済み $KEY_NAME を再利用。作成しない）..."
conoha network security-group create --name "$SG" --description "buzz sample" 2>/dev/null || log "  sg exists"
SGID="$(conoha network security-group show "$SG" --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
[ -n "$SGID" ] || die "could not resolve SG id for $SG"

log "2. SG rules: 22 / 80 / 443（生成後に存在を検証。silent 失敗を許さない — spec §6）..."
for p in 22 80 443; do
  conoha network security-group-rule create --security-group-id "$SGID" \
    --direction ingress --ethertype IPv4 --protocol tcp --port-min "$p" --port-max "$p" --remote-ip 0.0.0.0/0 2>/dev/null \
    || log "  rule tcp/$p may already exist"
done
# 22/80/443 が実在することをアサート（無ければ中断）
RULES_JSON="$(conoha network security-group show "$SG" --format json)"
for p in 22 80 443; do
  echo "$RULES_JSON" | python3 -c 'import sys,json
d=json.load(sys.stdin); p=int(sys.argv[1])
rs=d.get("security_group_rules", d.get("rules", []))
ok=any(r.get("port_range_min")==p and (r.get("protocol") or "").lower()=="tcp" for r in rs)
sys.exit(0 if ok else 1)' "$p" || die "SG rule tcp/$p missing after create"
done

log "3. image 確認 + VM 作成 (課金開始)..."
# カタログの正確な NAME を使う（`conoha image list` で実在確認済み: vmi-ubuntu-26.04-amd64 が唯一・active）。
# 短縮名 'ubuntu-26.04' はカタログ文字列に無く --no-input 下で server create が失敗する。
IMAGE="${IMAGE:-vmi-ubuntu-26.04-amd64}"
conoha image list 2>/dev/null | grep -q "$IMAGE" || die "image $IMAGE not in catalog; run 'conoha image list'"
conoha server create --name "$SERVER" --flavor "$FLAVOR" --image "$IMAGE" \
  --key-name "$KEY_NAME" --security-group "$SG" --no-input --yes --wait

log "4. 公開 IPv4 抽出 (ローカル正本)..."
IP="$(conoha server show "$SERVER" --format json | pubip)"
[ -n "$IP" ] || die "no public IPv4 for $SERVER"
FQDN="$(ip_to_dashes "$IP").sslip.io"; printf '%s' "$FQDN" > "$SECRETS/fqdn"
log "   IP=$IP  FQDN=$FQDN"

log "5. SSH 準備（keyscan を疎通ループ内で毎回試行。sshd 起動前の空 keyscan で詰まらない — 実測 2026-07-25）..."
# 原因（実測 2026-07-25）: 起動直後は sshd 未応答で ssh-keyscan が空を返し known_hosts が空のまま。
# → conoha server ssh の strict host-key 検証が毎回失敗し 5 分空回りした（keyscan がループ外で 1 回だけだった）。
# 対策: ループ内で毎回 keyscan を試み、鍵が入ってから conoha server ssh を試す（-R で重複を防ぐ）。
ok=0
for _ in $(seq 1 60); do
  ssh-keygen -R "$IP" >/dev/null 2>&1 || true
  ssh-keyscan -t ed25519,rsa,ecdsa "$IP" >> ~/.ssh/known_hosts 2>/dev/null || true
  if ssh_vm echo ok >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done
[ "$ok" = 1 ] || die "SSH to $SERVER not reachable (check SG / port 22)"

log "6. Docker 導入（先に cloud-init 完了を待ち、初回起動の apt ロック競合を回避 — 実測 2026-07-25）..."
# 実測 2026-07-25: 初回起動は cloud-init/unattended-upgrades が dpkg/apt ロックを保持し、
# get.docker.com 内の apt-get update が "Could not get lock" で即死した（UP_EXIT=100）。
# --wait で完了まで待ってから apt を触る（degraded でも続行 = || true。壊れていれば後続 apt/docker が loud に落ちる）。
ssh_vm 'cloud-init status --wait >/dev/null 2>&1 || true'
# get.docker.com は git を入れない。step 7 の clone に必要な前提を明示確保（本イメージには既在だが将来差分に備える）。
ssh_vm 'DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates >/dev/null'
ssh_vm 'curl -fsSL https://get.docker.com | sh >/dev/null'
CV="$(ssh_vm 'docker compose version --short' 2>/dev/null || true)"
log "   docker compose version=$CV"
# ≥ v2.24.4 必須（compose.caddy.yml の !reset タグ）。満たさなければ中断（reviewer F11）
# SC2016 disable: \$1 等は意図的にリテラルで、リモート（VM）の sh→awk が展開する。ローカルでの展開ではない。
# shellcheck disable=SC2016
ssh_vm 'docker compose version --short | awk -F. "{ exit !(\$1>2 || (\$1==2 && (\$2>24 || (\$2==24 && \$3>=4)))) }"' \
  || die "docker compose >= v2.24.4 required (got $CV)"

log "7. 上流取得 (完全 SHA で fetch)..."
ssh_vm "rm -rf /opt/buzz && mkdir -p /opt/buzz && cd /opt/buzz && \
  git init -q && git remote add origin https://github.com/block/buzz.git && \
  git fetch --depth 1 -q origin $BUZZ_GIT_REF && git checkout -q FETCH_HEAD"

log "8. オーナー鍵 (無ければ 1 回だけ生成。回転させない。DB 不要 = 起動前でよい)..."
if [ ! -f "$SECRETS/owner.pub" ]; then
  ssh_vm "docker run --rm --entrypoint buzz-admin $BUZZ_IMAGE generate-key" > "$SECRETS/owner.raw"
  # generate-key の実出力（実測 2026-07-25）は bech32 ではなくラベル + hex:
  #   Public key:  <64hex>
  #   Secret key:  <64hex>
  # ラベル行から hex を取る。owner.nsec は「秘密鍵の hex」を保持（BUZZ_PRIVATE_KEY に使う値そのもの）。
  sed -n 's/^[[:space:]]*Public key:[[:space:]]*//p' "$SECRETS/owner.raw" | grep -oiE '[0-9a-f]{64}' | head -1 > "$SECRETS/owner.pub"  || true
  sed -n 's/^[[:space:]]*Secret key:[[:space:]]*//p' "$SECRETS/owner.raw" | grep -oiE '[0-9a-f]{64}' | head -1 > "$SECRETS/owner.nsec" || true
  rm -f "$SECRETS/owner.raw"; chmod 600 "$SECRETS/owner.nsec"
fi
OWNER_PUB="$(cat "$SECRETS/owner.pub")"
[ -n "$OWNER_PUB" ] || die "owner pubkey empty (generate-key format changed? see .secrets/owner.raw)"
[ -s "$SECRETS/owner.nsec" ] || die "owner secret key empty"
log "   owner pubkey=$OWNER_PUB (secret kept local only, not logged)"

log "9. .env 生成 (VM 上, 冪等)..."
put_file "$HERE/bootstrap-env.sh" /opt/buzz/scripts-bootstrap-env.sh
ssh_vm "cd /opt/buzz/deploy/compose && BUZZ_IMAGE=$BUZZ_IMAGE \
  bash /opt/buzz/scripts-bootstrap-env.sh .env.example .env $IP sslip.io $OWNER_PUB"

log "10. 起動 (TLS)。上流この SHA はイメージに /data/git を持たず、Docker が git-data ボリュームを"
log "    root 所有で作るため relay(buzz uid1000) が pack-cache を作れず crash する（実測 2026-07-25）。"
log "    patch せず: 初回 up でボリュームを作らせ → 1000:1000 に chown → relay を再作成する。"
# 1) 初回 up: ボリューム/依存を作る。relay は unhealthy になり --wait は非ゼロで返るが続行（|| true）。
ssh_vm 'cd /opt/buzz/deploy/compose && BUZZ_COMPOSE_TLS=true ./run.sh start' 2>&1 | tee -a "$SECRETS/up.log" || true
# 2) git-data を buzz(1000:1000) 所有へ。イメージに /data/git 内容が無いため再マウントで copy されず chown が残る。
ssh_vm 'docker run --rm -v buzz-prod_buzz-git-data:/data/git alpine chown 1000:1000 /data/git'
# 3) 全スタックを再 up（relay が healthy になり、初回で relay 依存のため起動しなかった caddy も上がる）。
#    run.sh restart は relay だけ再作成し caddy を起動しないので不可。full start で --wait 全 healthy を待つ。成否は loud に。
ssh_vm 'cd /opt/buzz/deploy/compose && BUZZ_COMPOSE_TLS=true ./run.sh start' 2>&1 | tee -a "$SECRETS/up.log"

log "done. FQDN=$FQDN  次: ./verify.sh"
