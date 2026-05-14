"""GPU smoke job: verify the gpu-worker actually has a CUDA-capable device.

Submit with:
    slurm_cli.py submit torch_gpu_check.py \
        --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --inline

The job prints, in order:
  1. torch.cuda.is_available() and torch.cuda.device_count()
  2. The device name reported by torch.cuda.get_device_name(0)
  3. A matrix-multiply GFLOPS reading on the GPU at fp16 / fp32
  4. `nvidia-smi` output (handy for confirming the L4 visibility under
     the slurmd cgroup)

Exits non-zero (FAILED in Slurm) if no CUDA device is visible — that's
the signal the smoke test keys off when SLURM_SMOKE_GPU=1.
"""
import os
import shutil
import subprocess
import sys
import time

import torch


def banner(s: str) -> None:
    print(f"\n=== {s} ===", flush=True)


banner("torch / CUDA visibility")
print(f"torch={torch.__version__}")
print(f"torch.version.cuda={torch.version.cuda}")
print(f"torch.cuda.is_available()={torch.cuda.is_available()}")
print(f"torch.cuda.device_count()={torch.cuda.device_count()}")

if not torch.cuda.is_available():
    print("FAIL: no CUDA device visible to torch", file=sys.stderr)
    sys.exit(1)

banner("device 0")
print(f"name={torch.cuda.get_device_name(0)}")
print(f"capability={torch.cuda.get_device_capability(0)}")

banner("matmul GFLOPS on GPU")
N = int(os.environ.get("MATMUL_N", "4096"))
ROUNDS = int(os.environ.get("MATMUL_ROUNDS", "5"))
for dtype, label in [(torch.float32, "fp32"), (torch.float16, "fp16")]:
    a = torch.randn(N, N, dtype=dtype, device="cuda")
    b = torch.randn(N, N, dtype=dtype, device="cuda")
    # Warm up + cudnn autotune.
    for _ in range(2):
        _ = a @ b
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(ROUNDS):
        c = a @ b
    torch.cuda.synchronize()
    elapsed = time.perf_counter() - t0
    gflops = (2 * N**3 * ROUNDS) / elapsed / 1e9
    print(f"{label}: N={N} rounds={ROUNDS} elapsed={elapsed:.3f}s gflops={gflops:.1f}")
    del a, b, c
    torch.cuda.empty_cache()

banner("nvidia-smi")
nvsmi = shutil.which("nvidia-smi")
if nvsmi:
    # Quiet, parseable subset — full table is also fine but verbose.
    subprocess.run(
        [nvsmi, "--query-gpu=name,driver_version,memory.total,memory.used",
         "--format=csv"],
        check=False,
    )
else:
    # nvidia-smi missing inside the container is fine as long as torch saw
    # the device — the NVIDIA Container Toolkit may not have mounted the
    # binary. The torch report above is the source of truth.
    print("(nvidia-smi not on PATH; torch.cuda.is_available() is the SoT)")
