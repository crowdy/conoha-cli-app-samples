#!/usr/bin/env bash
# Single entrypoint for both slurm and slurmdbd containers.
# $ROLE selects behavior: "slurm" (default) or "slurmdbd".
set -euo pipefail

ROLE="${ROLE:-slurm}"

ensure_munge_key() {
    if [[ ! -s /etc/munge/munge.key ]]; then
        echo "[entrypoint] generating new munge key"
        dd if=/dev/urandom bs=1 count=1024 of=/etc/munge/munge.key 2>/dev/null
    fi
    chown munge:munge /etc/munge/munge.key
    chmod 0400 /etc/munge/munge.key
}

start_munged() {
    mkdir -p /run/munge && chown munge:munge /run/munge
    runuser -u munge -- munged --force
    # Wait until socket is ready
    for _ in $(seq 1 30); do
        [[ -S /run/munge/munge.socket.2 ]] && return 0
        sleep 0.2
    done
    echo "[entrypoint] munged failed to start" >&2
    exit 1
}

ensure_jwt_key() {
    local key=/var/spool/slurm/jwt_hs256.key
    if [[ ! -s "$key" ]]; then
        echo "[entrypoint] generating new JWT HS256 key"
        dd if=/dev/urandom bs=32 count=1 of="$key" 2>/dev/null
    fi
    chown slurm:slurm "$key"
    chmod 0600 "$key"
}

wait_for() {
    local host="$1" port="$2" max="${3:-60}"
    for _ in $(seq 1 "$max"); do
        nc -z "$host" "$port" && return 0
        sleep 1
    done
    echo "[entrypoint] timed out waiting for ${host}:${port}" >&2
    exit 1
}

run_slurmdbd() {
    ensure_munge_key
    start_munged
    # Substitute placeholder for DB password
    if [[ -z "${SLURM_DB_PASSWORD:-}" ]]; then
        echo "[entrypoint] SLURM_DB_PASSWORD is required" >&2
        exit 1
    fi
    sed -i "s|__SLURM_DB_PASSWORD__|${SLURM_DB_PASSWORD}|" /etc/slurm/slurmdbd.conf
    chmod 0600 /etc/slurm/slurmdbd.conf
    chown slurm:slurm /etc/slurm/slurmdbd.conf
    wait_for mariadb 3306 120
    echo "[entrypoint] starting slurmdbd"
    exec runuser -u slurm -- slurmdbd -D
}

run_slurm() {
    ensure_munge_key
    start_munged
    ensure_jwt_key
    mkdir -p /var/spool/slurm/ctld /var/spool/slurm/d /work/logs
    chown -R slurm:slurm /var/spool/slurm /work
    wait_for slurmdbd 6819 120
    echo "[entrypoint] starting slurmctld, slurmd, slurmrestd"
    runuser -u slurm -- slurmctld -D &
    SLURMCTLD_PID=$!
    sleep 2
    slurmd -D &
    SLURMD_PID=$!
    sleep 2
    # slurmrestd runs as slurm; -a rest_auth/jwt enables JWT-only auth on the listener
    runuser -u slurm -- slurmrestd -a rest_auth/jwt 0.0.0.0:6820 &
    SLURMRESTD_PID=$!
    trap 'kill $SLURMRESTD_PID $SLURMD_PID $SLURMCTLD_PID 2>/dev/null || true' TERM INT
    # Exit if any daemon dies
    wait -n $SLURMCTLD_PID $SLURMD_PID $SLURMRESTD_PID
    EC=$?
    echo "[entrypoint] a daemon exited with code $EC; shutting down" >&2
    kill $SLURMRESTD_PID $SLURMD_PID $SLURMCTLD_PID 2>/dev/null || true
    exit $EC
}

case "$ROLE" in
    slurm)    run_slurm ;;
    slurmdbd) run_slurmdbd ;;
    *) echo "[entrypoint] unknown ROLE=$ROLE (expected: slurm | slurmdbd)" >&2; exit 1 ;;
esac
