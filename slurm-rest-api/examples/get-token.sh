#!/usr/bin/env bash
# Fetch a Slurm JWT token by exec'ing into the running slurmctld container
# and running `scontrol token`. Intended to be run on the VM via:
#
#   conoha server ssh myserver -- ./examples/get-token.sh [username] [lifespan]
#
# Defaults:
#   username = slurm
#   lifespan = 86400 seconds (1 day)
#
# Prints the bare token to stdout (no trailing newline guarantees for sed/awk
# pipelines).
set -euo pipefail

USER_NAME="${1:-slurm}"
LIFESPAN="${2:-86400}"

# Find the running slurmctld container. We match by service label only —
# the compose project name varies: plain `docker compose up` uses the
# directory name (`slurm-rest-api`), while `conoha app deploy` creates
# `slurm-rest-api-accessories` for accessory containers. There's only one
# slurmctld on a VM either way.
CONTAINER=$(docker ps --filter "label=com.docker.compose.service=slurmctld" \
                       --format '{{.ID}}' | head -n1)

if [[ -z "${CONTAINER}" ]]; then
    echo "error: slurmctld container not running" >&2
    exit 1
fi

# `scontrol token` prints "SLURM_JWT=<token>"
TOKEN=$(docker exec -u slurm "${CONTAINER}" \
    scontrol token username="${USER_NAME}" lifespan="${LIFESPAN}" \
    | sed -n 's/^SLURM_JWT=//p' | tr -d '\n')

if [[ -z "${TOKEN}" ]]; then
    echo "error: scontrol token returned empty output" >&2
    exit 1
fi

printf '%s' "${TOKEN}"
