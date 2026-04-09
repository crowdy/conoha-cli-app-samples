#!/bin/bash
#
# install-on-conoha.sh — install Dokploy on a ConoHa VPS3 instance.
#
# Thin wrapper around the upstream installer (https://dokploy.com/install.sh)
# that adds value specific to ConoHa VPS or to reproducibility:
#
#   - Root check and port 80/443/3000 pre-check (fail fast on conflicts)
#   - Pinned DOKPLOY_VERSION for reproducibility (override via env var)
#   - DOCKER_SWARM_INIT_ARGS default that avoids 10.0.0.0/24 to leave room
#     around future ConoHa private networks
#
# Usage (recommended — run inside the ConoHa VPS via `conoha server ssh`):
#
#   curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh \
#     | sudo bash
#
# Usage (with a custom Dokploy version):
#
#   export DOKPLOY_VERSION=v0.28.8
#   curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh \
#     | sudo -E bash
#

set -euo pipefail

# ----------------------------------------------------------------------------
# Pinned defaults — bump these single lines to upgrade.
# Both can be overridden by exporting the matching env var before running.
# ----------------------------------------------------------------------------

DEFAULT_DOKPLOY_VERSION="v0.28.8"
DOKPLOY_VERSION="${DOKPLOY_VERSION:-$DEFAULT_DOKPLOY_VERSION}"

DEFAULT_SWARM_INIT_ARGS="--default-addr-pool 10.20.0.0/16 --default-addr-pool-mask-length 24"
DOCKER_SWARM_INIT_ARGS="${DOCKER_SWARM_INIT_ARGS:-$DEFAULT_SWARM_INIT_ARGS}"

# ----------------------------------------------------------------------------
# Pre-flight checks
# ----------------------------------------------------------------------------

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "Error: this script must be run as root. Re-run with sudo (e.g. 'curl -fsSL <url> | sudo bash' or 'sudo bash install-on-conoha.sh')." >&2
        exit 1
    fi
}

require_free_ports() {
    if ! command -v ss >/dev/null 2>&1; then
        echo "Error: 'ss' command not found. Install 'iproute2' and retry." >&2
        exit 1
    fi
    local conflicts=()
    local port
    for port in 80 443 3000; do  # 80/443 = Traefik, 3000 = Dokploy dashboard
        if ss -tulnH | awk '{print $5}' | grep -Eq ":${port}$"; then
            conflicts+=("${port}")
        fi
    done
    if [ "${#conflicts[@]}" -gt 0 ]; then
        echo "Error: the following port(s) are already in use: ${conflicts[*]}" >&2
        echo "Dokploy needs ports 80, 443, and 3000 to be free." >&2
        echo "Stop the conflicting service(s) and retry." >&2
        exit 1
    fi
}

# ----------------------------------------------------------------------------
# Install + post-install
# ----------------------------------------------------------------------------

run_upstream_installer() {
    echo "Installing Dokploy ${DOKPLOY_VERSION} via upstream install.sh ..."
    echo "Swarm init args: ${DOCKER_SWARM_INIT_ARGS}"
    export DOKPLOY_VERSION
    export DOCKER_SWARM_INIT_ARGS
    curl -fsSL https://dokploy.com/install.sh | bash
}

print_next_steps() {
    local public_ip
    public_ip="$(curl -4fsS --connect-timeout 5 https://ifconfig.io 2>/dev/null || echo '<server-ip>')"
    cat <<EOF

==============================================================
Dokploy installation complete.

Next steps:
  1. Open the dashboard:  http://${public_ip}:3000
  2. Create the initial admin user on first visit.
  3. Follow the README walkthrough to deploy your first app
     (hello-world from this repo) via the dashboard.
==============================================================
EOF
}

main() {
    require_root
    require_free_ports
    run_upstream_installer
    print_next_steps
}

# Brace group ensures bash reads the entire script before executing,
# which is the standard mitigation for `curl ... | bash` pipe-truncation.
{
    main "$@"
    exit $?
}
