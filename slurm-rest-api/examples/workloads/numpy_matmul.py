"""Matrix-multiply benchmark.

Submit with:
    slurm_cli.py submit numpy_matmul.py --cpus 2 --mem 512 --inline

Tune via env (slurm submit can pass with --export, omitted in this demo
for simplicity — defaults are fine for g2l-t-2).
"""
import os
import time

import numpy as np

N = int(os.environ.get("MATMUL_N", "2048"))
ROUNDS = int(os.environ.get("MATMUL_ROUNDS", "3"))

print(f"matmul: N={N} rounds={ROUNDS}")
a = np.random.rand(N, N).astype(np.float32)
b = np.random.rand(N, N).astype(np.float32)

t0 = time.perf_counter()
for i in range(ROUNDS):
    c = a @ b
elapsed = time.perf_counter() - t0
gflops = (2 * N**3 * ROUNDS) / elapsed / 1e9
print(f"elapsed={elapsed:.3f}s gflops={gflops:.2f}")
