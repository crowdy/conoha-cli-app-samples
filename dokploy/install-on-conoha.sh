#!/bin/bash
#
# install-on-conoha.sh — install Dokploy on a ConoHa VPS3 instance.
#
# Thin wrapper around the upstream installer (https://dokploy.com/install.sh)
# that adds value specific to ConoHa VPS or to reproducibility:
#
#   - Pinned DOKPLOY_VERSION for reproducibility (override via env var)
#   - DOCKER_SWARM_INIT_ARGS default that avoids 10.0.0.0/24 to leave room
#     around future ConoHa private networks
#   - ADVERTISE_ADDR auto-detection for ConoHa VPS3 hosts that only expose
#     a public IPv4 (upstream's get_private_ip() fails on these by default)
#
# Usage (recommended — run inside the ConoHa VPS via `conoha server ssh`):
#
#   curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh \
#     | sudo -E bash
#
# Note: `-E` preserves exported env vars through sudo. Without it, any
# DOKPLOY_VERSION / DOCKER_SWARM_INIT_ARGS / ADVERTISE_ADDR you set will
# be silently dropped before the wrapper sees them.
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
# All can be overridden by exporting the matching env var before running.
# ----------------------------------------------------------------------------

DEFAULT_DOKPLOY_VERSION="v0.28.8"
DOKPLOY_VERSION="${DOKPLOY_VERSION:-$DEFAULT_DOKPLOY_VERSION}"

DEFAULT_SWARM_INIT_ARGS="--default-addr-pool 10.20.0.0/16 --default-addr-pool-mask-length 24"
DOCKER_SWARM_INIT_ARGS="${DOCKER_SWARM_INIT_ARGS:-$DEFAULT_SWARM_INIT_ARGS}"

# ----------------------------------------------------------------------------
# Pre-flight
# ----------------------------------------------------------------------------

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "Error: this script must be run as root. Re-run with sudo (e.g. 'curl -fsSL <url> | sudo -E bash' or 'sudo -E bash install-on-conoha.sh')." >&2
        exit 1
    fi
}

# Upstream's install.sh derives --advertise-addr from a private RFC1918 IP.
# ConoHa VPS3's default network only exposes a public IPv4, so upstream's
# detection fails before Swarm init. Detect this case and pre-set
# ADVERTISE_ADDR so upstream skips its (failing) get_private_ip() path.
ensure_advertise_addr() {
    if [ -n "${ADVERTISE_ADDR:-}" ]; then
        echo "Using ADVERTISE_ADDR from environment: ${ADVERTISE_ADDR}"
        return
    fi

    if ip addr show 2>/dev/null | grep -qE "inet (192\.168\.|10\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.)"; then
        # A private address exists; upstream's get_private_ip() will find it.
        return
    fi

    local public_ip=""
    local url
    for url in https://ifconfig.io https://icanhazip.com https://ipecho.net/plain; do
        public_ip="$(curl -4fsS --connect-timeout 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
        if [ -n "$public_ip" ]; then
            break
        fi
    done

    if [ -z "$public_ip" ]; then
        echo "Error: could not auto-detect a public IPv4 for ADVERTISE_ADDR." >&2
        echo "Set it manually and retry:" >&2
        echo "  ADVERTISE_ADDR=<your-server-ip> sudo -E bash install-on-conoha.sh" >&2
        exit 1
    fi

    ADVERTISE_ADDR="$public_ip"
    export ADVERTISE_ADDR
    echo "No private IP found on host. Using detected public IPv4 for ADVERTISE_ADDR: ${ADVERTISE_ADDR}"
}

# ----------------------------------------------------------------------------
# Install
# ----------------------------------------------------------------------------

run_upstream_installer() {
    echo "Installing Dokploy ${DOKPLOY_VERSION} via upstream install.sh ..."
    echo "Swarm init args: ${DOCKER_SWARM_INIT_ARGS}"
    export DOKPLOY_VERSION
    export DOCKER_SWARM_INIT_ARGS
    curl -fsSL https://dokploy.com/install.sh | bash
}

main() {
    require_root
    ensure_advertise_addr
    run_upstream_installer
}

# Brace group ensures `main` is fully parsed before invocation, the standard
# mitigation for `curl ... | bash` pipe-truncation. Keep destructive logic
# inside main(), not at top level.
{
    main "$@"
    exit $?
}
