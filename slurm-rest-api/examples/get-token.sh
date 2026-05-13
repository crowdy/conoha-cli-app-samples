#!/usr/bin/env bash
# Fetch a Slurm JWT token by exec'ing into the running slurm container
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

# Find the running slurm-rest-api_slurm container. compose's project name is
# the directory name on the VM (slurm-rest-api).
CONTAINER=$(docker ps --filter "label=com.docker.compose.service=slurm" \
                       --filter "label=com.docker.compose.project=slurm-rest-api" \
                       --format '{{.ID}}' | head -n1)

if [[ -z "${CONTAINER}" ]]; then
    echo "error: slurm container not running (compose project: slurm-rest-api)" >&2
    exit 1
fi

# `scontrol token` prints "SLURM_JWT=<token>"
docker exec -u slurm "${CONTAINER}" \
    scontrol token username="${USER_NAME}" lifespan="${LIFESPAN}" \
    | awk -F= 'NR==1 { printf "%s", $2 }'
