FROM giovtorres/slurm-docker-cluster:25.11.4 AS base

# Bootstrap pip on the base image's Python 3.12 (Rocky 9 ships no pip for it).
RUN python3 -m ensurepip --upgrade

# CPU stage: the scientific stack our cpu workloads need (numpy_matmul,
# hyperparam_sweep). cpu-worker / slurmctld / slurmdbd / slurmrestd all
# build to this target.
FROM base AS cpu
RUN python3 -m pip install --no-cache-dir \
        'numpy~=2.4' 'scikit-learn~=1.8'

# GPU stage: cpu layer plus torch CUDA wheels for torch_gpu_check.py.
# Only gpu-worker references this target — keeping the cpu-worker image
# slim avoids a ~2.5 GB layer it would never use.
#
# Default `pip install torch` pulls the manylinux cu12x wheel, which works
# with NVIDIA driver R535+ (the vllm-gpu / hunyuan3d-gpu samples document
# the same driver floor for ConoHa L4 hosts).
FROM cpu AS gpu
RUN python3 -m pip install --no-cache-dir torch matplotlib

# Wrap the upstream entrypoint so we can generate /etc/slurm/gres.conf
# before slurmd starts — the giovtorres image's Slurm is not built with
# NVML support, so the gres/gpu plugin can't autodetect L4 devices on
# its own. See entrypoint-gpu.sh for the full rationale.
COPY entrypoint-gpu.sh /usr/local/bin/entrypoint-gpu.sh
RUN chmod +x /usr/local/bin/entrypoint-gpu.sh
ENTRYPOINT ["/usr/local/bin/entrypoint-gpu.sh"]
