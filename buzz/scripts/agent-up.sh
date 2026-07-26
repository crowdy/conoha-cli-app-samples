#!/usr/bin/env bash
# VM 上で buzz-acp/buzz をビルドし、Claude エージェントを systemd 常駐させる（Phase B / Task 7）。
# 実測（2026-07-25）で確定した構成を反映。秘密（agent nsec / Claude トークン）は stdin で VM の
# root-only ファイルへ置き、コマンド行・tee ログには出さない。
#
# Claude 認証（spec §5.2）:
#   O-1 サブスクリプション OAuth（既定）: VM で `claude setup-token` を実行して長寿命トークンを得て、
#       CLAUDE_CODE_OAUTH_TOKEN として本スクリプトに渡す（例: CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat... ./agent-up.sh）。
#       claude CLI は本スクリプトが導入するので、初回は「ビルド後に VM で setup-token → 再実行 or 下記の追記」でよい。
#   O-3 フォールバック: ANTHROPIC_API_KEY を渡す（課金は API 従量）。
#   どちらも無ければ systemd は用意するが LLM 呼び出しは 401 になる。その場合の手順を loud に表示する（silent に O-3 化しない）。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
load_ref
SERVER="${SERVER:-buzz-sample}"
SECRETS="$HERE/../.secrets"
FQDN="$(cat "$SECRETS/fqdn")"; OWNER_PUB="$(cat "$SECRETS/owner.pub")"
[ -s "$SECRETS/owner.nsec" ] || die "owner secret missing ($SECRETS/owner.nsec) — run up.sh first"
[ -n "$OWNER_PUB" ] || die "owner pubkey empty"
DC="cd /opt/buzz/deploy/compose && docker compose"

log "1. ビルド依存 + Node + Rust ツールチェーン（実測: cloud-init は up.sh で待機済み）..."
ssh_vm 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && \
  apt-get install -y -qq build-essential pkg-config libssl-dev cmake ca-certificates git curl nodejs npm >/dev/null'

log "2. Claude CLI + ACP アダプタ（npm -g）。buzz-acp が claude-agent-acp を spawn し、それが claude を使う..."
ssh_vm 'npm install -g @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp >/dev/null 2>&1 || true'
ssh_vm 'command -v claude && command -v claude-agent-acp' | tee -a "$SECRETS/agent.log"

log "3. buzz-acp / buzz をビルド（rust-toolchain.toml が版を固定。実測 2m 程度）..."
ssh_vm 'command -v cargo >/dev/null || (curl -fsSL https://sh.rustup.rs | sh -s -- -y >/dev/null 2>&1)'
# SC2016 disable: $HOME はリモート（VM）の shell が展開する。ローカル展開ではない。
# shellcheck disable=SC2016
ssh_vm '. "$HOME/.cargo/env" && cd /opt/buzz && cargo build --release --locked -p buzz-acp -p buzz-cli' \
  2>&1 | tee -a "$SECRETS/agent.log"
# -p buzz-cli の成果物は buzz（buzz-cli ではない）
ssh_vm 'install -m755 /opt/buzz/target/release/buzz-acp /opt/buzz/target/release/buzz /usr/local/bin/'
ssh_vm 'command -v buzz-acp && command -v buzz && buzz --help | head -1' | tee -a "$SECRETS/agent.log"

log "4. エージェント鍵（無ければ 1 回だけ生成。generate-key は Public/Secret ラベル + hex — 実測）..."
if [ ! -f "$SECRETS/agent.pub" ]; then
  ssh_vm "$DC exec -T relay buzz-admin generate-key" > "$SECRETS/agent.raw"
  sed -n 's/^[[:space:]]*Public key:[[:space:]]*//p' "$SECRETS/agent.raw" | grep -oiE '[0-9a-f]{64}' | head -1 > "$SECRETS/agent.pub"  || true
  sed -n 's/^[[:space:]]*Secret key:[[:space:]]*//p' "$SECRETS/agent.raw" | grep -oiE '[0-9a-f]{64}' | head -1 > "$SECRETS/agent.nsec" || true
  rm -f "$SECRETS/agent.raw"; chmod 600 "$SECRETS/agent.nsec"
fi
AGENT_PUB="$(cat "$SECRETS/agent.pub")"
if [ -z "$AGENT_PUB" ] || [ ! -s "$SECRETS/agent.nsec" ]; then die "agent key generation failed"; fi
# メンバー登録（DB+Redis+relay 鍵が要るので relay exec 経由。owner は bootstrap_owner が自動登録済み）
ssh_vm "$DC exec -T relay buzz-admin add-member --pubkey $AGENT_PUB --role member" 2>&1 | tail -1
ssh_vm "$DC exec -T relay buzz-admin list-members" | grep -qi "$AGENT_PUB" || die "agent not in members after add"
log "   agent pubkey=$AGENT_PUB (secret local only, not logged)"

log "5. VM root-only env を stdin で配置（nsec/トークンをコマンド行・ログに出さない）..."
# エージェント nsec（buzz-acp と buzz CLI 用）。BUZZ_PRIVATE_KEY は hex 秘密鍵でよい（実測）。
printf 'BUZZ_PRIVATE_KEY=%s\nBUZZ_RELAY_URL=wss://%s\n' "$(cat "$SECRETS/agent.nsec")" "$FQDN" \
  | ssh_vm 'umask 077; cat > /root/.buzz-agent.env'
# オーナー nsec（テスト送信用。§4.0 逸脱 — VM 破棄で消える）
printf 'BUZZ_PRIVATE_KEY=%s\nBUZZ_RELAY_URL=wss://%s\n' "$(cat "$SECRETS/owner.nsec")" "$FQDN" \
  | ssh_vm 'umask 077; cat > /root/.buzz-owner.env'

log "6. Claude 認証をエージェント env へ（§5.2。O-1 OAuth を優先、無ければ O-3、どちらも無ければ loud）..."
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  # O-1: 事前に VM で `claude setup-token` して得た sk-ant-oat... を渡す
  printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_CODE_OAUTH_TOKEN" | ssh_vm 'umask 077; cat >> /root/.buzz-agent.env'
  log "   O-1 subscription OAuth token を配置（claude auth: oauth_token）"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" | ssh_vm 'umask 077; cat >> /root/.buzz-agent.env'
  log "   O-3 ANTHROPIC_API_KEY を配置（API 従量課金）"
else
  cat >&2 <<EOF
[buzz] ────────────────────────────────────────────────────────────
[buzz] Claude 認証が未指定です（silent に進めない — spec §5.2）。以下のいずれか:
[buzz]   O-1（サブスクリプション OAuth・既定）: VM で対話的に取得して追記し、再起動:
[buzz]       conoha server ssh $SERVER          # VM に入る
[buzz]       claude setup-token                 # ブラウザ承認 → 末尾に出る sk-ant-oat... を控える
[buzz]       printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' 'sk-ant-oat...' >> /root/.buzz-agent.env
[buzz]       systemctl restart buzz-acp
[buzz]   O-3（フォールバック）: ANTHROPIC_API_KEY=... ./agent-up.sh で再実行
[buzz] トークン未設定のままだと buzz-acp は 401（Invalid bearer token）でエージェント応答不可。
[buzz] ────────────────────────────────────────────────────────────
EOF
fi

log "7. systemd 登録（実測の env 変数名。RESPOND_TO=allowlist にオーナー、AGENT_OWNER 明示。HOME=/root で OAuth 資格参照）..."
# buzz-acp の agent-command 既定は goose。claude-agent-acp は引数無しで ACP を stdio 起動するため AGENT_ARGS は空にする（実測）。
{
  printf '[Unit]\nDescription=Buzz ACP harness (Claude agent)\nAfter=network-online.target\n\n'
  printf '[Service]\n'
  printf 'EnvironmentFile=/root/.buzz-agent.env\n'            # BUZZ_PRIVATE_KEY / BUZZ_RELAY_URL / CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY
  printf 'Environment=HOME=/root\n'                            # claude 資格の探索先
  printf 'Environment=BUZZ_ACP_AGENT_COMMAND=claude-agent-acp\n'
  printf 'Environment=BUZZ_ACP_AGENT_ARGS=\n'                  # 空（goose 用の "acp" を上書き）
  printf 'Environment=BUZZ_ACP_SUBSCRIBE=mentions\n'
  printf 'Environment=BUZZ_ACP_RESPOND_TO=allowlist\n'
  printf 'Environment=BUZZ_ACP_RESPOND_TO_ALLOWLIST=%s\n' "$OWNER_PUB"
  printf 'Environment=BUZZ_ACP_AGENT_OWNER=%s\n' "$OWNER_PUB"
  printf 'ExecStart=/usr/local/bin/buzz-acp\nRestart=on-failure\nRestartSec=5\n\n'
  printf '[Install]\nWantedBy=multi-user.target\n'
} | ssh_vm 'umask 077; cat > /etc/systemd/system/buzz-acp.service'
ssh_vm 'systemctl daemon-reload && systemctl enable --now buzz-acp'
sleep 5
ssh_vm 'systemctl is-active buzz-acp && journalctl -u buzz-acp --no-pager -n 12' | tee -a "$SECRETS/agent.log"

log "8. デモチャンネル（owner 作成 → agent 参加 → agent プロフィール名 'agent' で @agent 解決可能に）..."
if [ ! -s "$SECRETS/channel" ]; then
  CH="$(ssh_vm "set -a; . /root/.buzz-owner.env; set +a; buzz channels create --name demo --type stream --visibility open" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin).get("channel_id",""))')"
  [ -n "$CH" ] || die "channel create failed"
  printf '%s' "$CH" > "$SECRETS/channel"
fi
CH="$(cat "$SECRETS/channel")"
ssh_vm "set -a; . /root/.buzz-agent.env; set +a; buzz channels join --channel $CH" >/dev/null 2>&1 || true
ssh_vm "set -a; . /root/.buzz-agent.env; set +a; buzz users set-profile --name agent" >/dev/null 2>&1 || true
# メンバーシップ通知で buzz-acp が当該チャンネルを購読する（実測）。反映のため再起動して確実に。
ssh_vm 'systemctl restart buzz-acp'; sleep 4
ssh_vm 'journalctl -u buzz-acp --no-pager -n 6 | grep -iE "discovered|subscribed to channel" || true'

log "done. channel=$CH  次: ./verify.sh --agent"
# 認証未設定なら loud に警告（VM 側で grep。秘密をローカルに転送しない）
ssh_vm 'grep -q "^CLAUDE_CODE_OAUTH_TOKEN=\|^ANTHROPIC_API_KEY=" /root/.buzz-agent.env' \
  || log "WARN: Claude 認証未設定。上記手順で設定し systemctl restart buzz-acp してから verify.sh --agent"
