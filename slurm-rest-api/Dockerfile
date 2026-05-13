FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl netcat-openbsd procps \
        munge libmunge2 \
        slurmctld slurmd slurm-client slurmdbd slurmrestd \
        libjwt2 libjson-c5 libyaml-0-2 \
        mariadb-client \
        python3 python3-pip python3-venv \
        python3-numpy python3-sklearn python3-requests python3-click \
    && rm -rf /var/lib/apt/lists/*

# The slurm user (uid 64030) is created by the slurm-wlm package. Ensure
# /var/spool/slurm and /var/log/slurm are owned by slurm.
RUN mkdir -p /var/spool/slurm /var/log/slurm /work/scripts /work/results /work/logs \
    && chown -R slurm:slurm /var/spool/slurm /var/log/slurm /work \
    && chmod 0755 /work

COPY slurm/slurm.conf      /etc/slurm/slurm.conf
COPY slurm/cgroup.conf     /etc/slurm/cgroup.conf
COPY slurm/slurmdbd.conf   /etc/slurm/slurmdbd.conf
COPY slurm/entrypoint.sh   /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
    && chmod 0600 /etc/slurm/slurmdbd.conf \
    && chown slurm:slurm /etc/slurm/slurmdbd.conf

EXPOSE 6820 6817 6818 6819

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
