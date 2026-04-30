# Hunyuan3D-2 GPU Sample Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `hunyuan3d-gpu/` sample that runs Tencent Hunyuan3D-2 image-to-3D on a ConoHa L4 GPU server, exposing a Gradio WebUI on `:7860`. Verify end-to-end on real hardware.

**Architecture:** Self-built Docker image (PyTorch 2.4 + CUDA 12.4 base, C++ extensions pre-baked) + compose.yml with NVIDIA reservation + entrypoint.sh that downloads ~10GB model weights on first boot then runs `gradio_app.py`. Raw IP exposure (no `conoha.yml`). Smoke test via WebUI image upload, then `conoha server destroy`.

**Tech Stack:** Docker + docker compose v2, PyTorch 2.4 + CUDA 12.4, Hunyuan3D-2 (`f8db630...`), Gradio, ConoHa CLI v0.5.10.

**Spec:** `docs/superpowers/specs/2026-04-30-hunyuan3d-gpu-design.md`

**Note on testing:** This is infrastructure code with no unit-testable logic. Validation is layered: (1) cheap local checks (`docker compose config`, `bash -n`, `docker build --check`), (2) a real-hardware smoke test on ConoHa L4 GPU. There are no pytest-style tests.

---

## Phase A — Author files in repo

### Task A1: Scaffold sample directory + .dockerignore

**Files:**
- Create: `hunyuan3d-gpu/.dockerignore`

- [ ] **Step 1: Create the directory and .dockerignore**

```bash
mkdir -p hunyuan3d-gpu
cat > hunyuan3d-gpu/.dockerignore <<'EOF'
.git
.gitignore
.dockerignore
README.md
*.md
EOF
```

- [ ] **Step 2: Verify directory exists**

Run: `ls hunyuan3d-gpu/`
Expected: `.dockerignore` listed.

---

### Task A2: Write entrypoint.sh

**Files:**
- Create: `hunyuan3d-gpu/entrypoint.sh`

- [ ] **Step 1: Write entrypoint.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

MODEL_REPO="${MODEL_REPO:-tencent/Hunyuan3D-2}"
MODEL_DIR="${HF_HOME:-/root/.cache/huggingface}/hub/models--${MODEL_REPO//\//--}"
SENTINEL="$MODEL_DIR/.download_complete"

mkdir -p /app/outputs "$(dirname "$MODEL_DIR")"

if [ ! -f "$SENTINEL" ]; then
    log "Downloading model weights: $MODEL_REPO (~10GB, first boot only)"
    huggingface-cli download "$MODEL_REPO" --local-dir-use-symlinks False
    touch "$SENTINEL"
    log "Model download complete"
else
    log "Model weights cache hit, skipping download"
fi

log "GPU info:"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader || true

log "Starting Hunyuan3D-2 Gradio app on 0.0.0.0:7860"
exec python3 gradio_app.py
```

- [ ] **Step 2: Make it executable and syntax-check**

```bash
chmod +x hunyuan3d-gpu/entrypoint.sh
bash -n hunyuan3d-gpu/entrypoint.sh
```

Expected: no output (clean syntax).

---

### Task A3: Write Dockerfile

**Files:**
- Create: `hunyuan3d-gpu/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TORCH_CUDA_ARCH_LIST=8.9 \
    HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates build-essential \
        libgl1 libglib2.0-0 libegl1 libgles2 \
        ninja-build pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG HUNYUAN3D_REF=f8db63096c8282cb27354314d896feba5ba6ff8a
RUN git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git . \
    && git checkout ${HUNYUAN3D_REF} \
    && git rev-parse HEAD > /app/.commit

RUN pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install -e . && \
    pip install "huggingface_hub[cli]" hf_transfer

# Pre-build C++ extensions so first boot only downloads weights
RUN cd hy3dgen/texgen/custom_rasterizer && python3 setup.py install && cd /app
RUN cd hy3dgen/texgen/differentiable_renderer && python3 setup.py install && cd /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7860
ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: Lint the Dockerfile**

Run: `cd hunyuan3d-gpu && docker buildx build --check . ; cd ..`
Expected: no warnings/errors. (If `--check` is unavailable on this docker version, just verify the file parses by running `docker build -t hunyuan3d-gpu:lint --dry-run .` or skip — local Dockerfile lint is best-effort.)

---

### Task A4: Write compose.yml

**Files:**
- Create: `hunyuan3d-gpu/compose.yml`

- [ ] **Step 1: Write compose.yml**

```yaml
services:
  hunyuan3d:
    build: .
    image: hunyuan3d-gpu:local
    ports:
      - "7860:7860"
    volumes:
      - hf_cache:/root/.cache/huggingface
      - outputs:/app/outputs
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    environment:
      - HF_HOME=/root/.cache/huggingface
      - TORCH_CUDA_ARCH_LIST=8.9
      - GRADIO_SERVER_NAME=0.0.0.0
      - GRADIO_SERVER_PORT=7860
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7860/"]
      interval: 30s
      timeout: 10s
      retries: 30
      start_period: 900s
    restart: unless-stopped

volumes:
  hf_cache:
  outputs:
```

- [ ] **Step 2: Validate compose schema**

Run: `cd hunyuan3d-gpu && docker compose config > /dev/null && cd ..`
Expected: exits 0 with no output. If it errors, fix the YAML before continuing.

---

### Task A5: Write README.md

**Files:**
- Create: `hunyuan3d-gpu/README.md`

- [ ] **Step 1: Write the README**

Use the structure from `fish-speech-tts-gpu/README.md`. Headings in Japanese. Required sections (with the noted content):

```markdown
# Hunyuan3D 2 (GPU)

NVIDIA L4 GPU を使用して、Tencent Hunyuan3D-2 で画像から 3D モデル (GLB) を生成するサンプルです。Gradio WebUI で 1 枚の画像をアップロードするだけで shape (+ optional texture) を生成・ダウンロードできます。

## 構成

| サービス | ポート | 説明 |
|---------|--------|------|
| Hunyuan3D Gradio WebUI | 7860 | 画像→3D 生成 UI |

## 前提条件

- [conoha-cli](https://github.com/because-and/conoha-cli) v0.5.0 以上
- SSH キーが登録済み
- **GPU フレーバー**: `g2l-t-c20m128g1-l4` (NVIDIA L4 24GB)

## GPU セットアップ

(fish-speech-tts-gpu の Step 1〜5 と同一手順。NVIDIA Container Toolkit + ドライバ + 再起動 + nvidia-smi 確認)

### Step 1: サーバー作成
\`\`\`bash
conoha server add --flavor g2l-t-c20m128g1-l4 --image ubuntu-24.04 --key mykey --name hunyuan3d
\`\`\`

### Step 2: NVIDIA Container Toolkit
\`\`\`bash
conoha server ssh hunyuan3d
\`\`\`
\`\`\`bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
\`\`\`

### Step 3: NVIDIA ドライバ
\`\`\`bash
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu
\`\`\`

### Step 4: 再起動
\`\`\`bash
exit
conoha server reboot hunyuan3d
\`\`\`

### Step 5: ドライバ確認
\`\`\`bash
conoha server ssh hunyuan3d
sudo apt install -y nvidia-utils-570-server
nvidia-smi
\`\`\`

## デプロイ

\`\`\`bash
conoha app deploy hunyuan3d --app hunyuan3d-gpu
\`\`\`

初回起動は **15〜20 分** かかります (Docker build ~5 分 + モデル DL ~10 分)。`docker compose ps` の healthcheck が `healthy` になるまで待ってください。2 回目以降は即起動します。

## 動作確認

ブラウザで `http://<サーバーIP>:7860` にアクセス。`assets/example_images/004.png` のような被写体中央のサンプル画像をアップロードし、shape only モードで生成→GLB ダウンロード。生成時間目安は shape のみ 30〜60 秒、shape + texture 60〜120 秒。

ダウンロードした GLB を Blender や https://gltf-viewer.donmccurdy.com/ で開いて確認できます。

## 既知の制限

- 入力画像は背景単色 / 透過 PNG、被写体中央が推奨。透明素材・極端なポーズは苦手
- 24GB L4 でも条件次第で texture 生成時に OOM の可能性。OOM 時は texture を切って shape only モードに
- シリアル処理 (同時利用キュー無し)
- HTTPS 無し / 認証無し (本サンプルはスモーク用途)

## ライセンス

Hunyuan3D-2 は **Tencent Hunyuan Community License**:
- 商用利用可 (月間アクティブユーザー 1 億未満の場合)
- 出力物の商用利用可

公式: https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE
```

- [ ] **Step 2: Verify the file is well-formed Markdown**

Run: `head -20 hunyuan3d-gpu/README.md`
Expected: title line and table render readably.

---

### Task A6: Register sample in root README

**Files:**
- Modify: `README.md` (top-level)

- [ ] **Step 1: Find where existing GPU samples are listed**

Run: `grep -n -i 'fish-speech\|ollama-webui-gpu\|GPU' README.md | head -20`

Identify the section/table where `fish-speech-tts-gpu` is registered. Insert a new entry for `hunyuan3d-gpu` directly under it, in the same format. Match the existing style — if entries use `| サンプル | 説明 |`, use that. If they use bullets, use bullets.

- [ ] **Step 2: Add the entry**

Mirror the format. Description: `画像→3D モデル (GLB) 生成 (Tencent Hunyuan3D-2, NVIDIA L4 GPU)`.

- [ ] **Step 3: Verify**

Run: `grep -A 1 -B 1 'hunyuan3d-gpu' README.md`
Expected: the new entry appears in context with surrounding GPU samples.

---

## Phase B — Local validation + commit

### Task B1: Final local validation pass

- [ ] **Step 1: Re-run all cheap local checks**

```bash
bash -n hunyuan3d-gpu/entrypoint.sh
cd hunyuan3d-gpu && docker compose config > /dev/null && cd ..
```

Expected: both exit 0.

- [ ] **Step 2: Verify directory contents**

Run: `ls -la hunyuan3d-gpu/`
Expected: `.dockerignore`, `Dockerfile`, `README.md`, `compose.yml`, `entrypoint.sh` all present. `entrypoint.sh` is executable.

---

### Task B2: Commit

- [ ] **Step 1: Stage and commit the new sample**

```bash
git add hunyuan3d-gpu/ README.md
git commit -m "$(cat <<'EOF'
feat(hunyuan3d-gpu): add image-to-3D sample with Hunyuan3D-2 on L4 GPU (#86)

MVP scope: Dockerfile (PyTorch 2.4 + CUDA 12.4, C++ extensions pre-built)
+ compose.yml (NVIDIA reservation, raw IP :7860) + entrypoint.sh (model
weight cache guard) + README. Pinned to Hunyuan3D-2 commit f8db630.

Closes #86

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify**

Run: `git log --oneline -1`
Expected: commit subject matches.

---

## Phase C — Deploy to ConoHa & smoke test

> **Authorization scope:** The user pre-approved (in brainstorming) creating the L4 GPU server, deploying, smoke testing, and **destroying the server upon smoke success**. If smoke fails, do NOT destroy automatically — diagnose first and ask.

### Task C1: Verify ConoHa CLI auth

- [ ] **Step 1: Check auth state**

Run: `conoha auth status 2>&1 | head -10`
Expected: shows authenticated user. If not authenticated, stop and ask user to run `conoha auth login` interactively (it requires terminal input).

- [ ] **Step 2: Confirm SSH key registered**

Run: `conoha keypair list`
Expected: at least one key. Note the key name to use as `--key` in the next task.

---

### Task C2: Create the GPU server

- [ ] **Step 1: Create**

Replace `<KEY>` with the keypair name from C1.

```bash
conoha server add \
  --flavor g2l-t-c20m128g1-l4 \
  --image ubuntu-24.04 \
  --key <KEY> \
  --name hunyuan3d
```

Expected: server is created and shows up in `conoha server list`. Note the IP.

- [ ] **Step 2: Wait for ACTIVE**

```bash
conoha server show hunyuan3d --format json | grep -i status
```

Expected: `ACTIVE` (poll every ~30s; usually < 2 min).

---

### Task C3: GPU host setup

- [ ] **Step 1: SSH and install NVIDIA Container Toolkit**

```bash
conoha server ssh hunyuan3d -- bash -lc '
set -euxo pipefail
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed "s#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g" | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
'
```

Expected: exits 0.

- [ ] **Step 2: Install NVIDIA driver**

```bash
conoha server ssh hunyuan3d -- bash -lc '
set -euxo pipefail
sudo apt-get install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu
'
```

Expected: exits 0.

- [ ] **Step 3: Reboot**

```bash
conoha server reboot hunyuan3d
```

Wait ~60s for the server to come back, then poll until SSH responds:

```bash
until conoha server ssh hunyuan3d -- echo ok 2>/dev/null; do sleep 5; done
```

- [ ] **Step 4: Verify GPU**

```bash
conoha server ssh hunyuan3d -- bash -lc '
sudo apt-get install -y nvidia-utils-570-server
nvidia-smi
'
```

Expected: output shows `NVIDIA L4` and a driver version. **If GPU is not detected, stop and diagnose** — do not proceed.

---

### Task C4: Deploy the app

- [ ] **Step 1: Deploy**

```bash
conoha app deploy hunyuan3d --app hunyuan3d-gpu
```

Expected: command returns 0; deployment artifacts uploaded.

- [ ] **Step 2: Wait for healthy**

The first boot performs Docker build (~5 min) + model download (~10 min). Poll for healthcheck:

```bash
until conoha server ssh hunyuan3d -- 'cd ~/apps/hunyuan3d-gpu && docker compose ps --format json | grep -q "\"Health\":\"healthy\""'; do
  date; conoha server ssh hunyuan3d -- 'cd ~/apps/hunyuan3d-gpu && docker compose ps' 2>/dev/null || true
  sleep 60
done
```

Expected: container reaches `healthy` within ~20 minutes.

If healthcheck fails persistently:
- Inspect logs: `conoha server ssh hunyuan3d -- 'cd ~/apps/hunyuan3d-gpu && docker compose logs --tail=200 hunyuan3d'`
- Common cause: model DL stalled — verify network and `huggingface-cli` is invoked correctly.
- Do NOT proceed to smoke test until healthy.

---

### Task C5: Smoke test

- [ ] **Step 1: HTTP probe**

```bash
SERVER_IP=$(conoha server show hunyuan3d --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["addresses"][0]["addr"])')
curl -sS -o /dev/null -w '%{http_code}\n' "http://${SERVER_IP}:7860/"
```

Expected: `200`.

- [ ] **Step 2: WebUI generation via Gradio API**

The Hunyuan3D-2 `gradio_app.py` exposes a Gradio HTTP API. Use a Python helper to upload `assets/example_images/004.png` (already inside the container at `/app/assets/example_images/004.png`) and download the resulting GLB.

Run on the server (via SSH) so we don't transfer the image over the public internet:

```bash
conoha server ssh hunyuan3d -- bash -lc '
docker exec $(docker compose -f ~/apps/hunyuan3d-gpu/compose.yml ps -q hunyuan3d) python3 - <<PY
from gradio_client import Client, file
import shutil, time

client = Client("http://localhost:7860/")
t0 = time.time()
result = client.predict(
    image=file("/app/assets/example_images/004.png"),
    api_name="/shape_generation",  # shape-only path; texture toggle disabled
)
elapsed = time.time() - t0
print(f"shape elapsed: {elapsed:.1f}s")
print(f"output: {result}")
shutil.copy(result, "/app/outputs/smoke.glb")
PY
'
```

Note: the exact `api_name` depends on `gradio_app.py`. If `/shape_generation` is wrong, list endpoints first:

```bash
conoha server ssh hunyuan3d -- 'docker exec $(docker compose -f ~/apps/hunyuan3d-gpu/compose.yml ps -q hunyuan3d) python3 -c "from gradio_client import Client; c=Client(\"http://localhost:7860/\"); print(c.view_api(return_format=\"dict\"))"'
```

Pick the function whose name corresponds to "shape generation" / image-to-mesh and re-run.

Expected: shape generation completes within ~60s and writes a non-zero `smoke.glb` into the `outputs` volume.

- [ ] **Step 3: Validate output**

```bash
conoha server ssh hunyuan3d -- bash -lc '
docker exec $(docker compose -f ~/apps/hunyuan3d-gpu/compose.yml ps -q hunyuan3d) bash -c "
  ls -la /app/outputs/smoke.glb &&
  file /app/outputs/smoke.glb
"
'
```

Expected: file exists, size > 0, `file` reports `Khronos glTF model` or similar GLB binary indicator.

- [ ] **Step 4: Capture smoke log**

Save the elapsed time and `nvidia-smi` snapshot to a local artifact for the PR description:

```bash
mkdir -p .artifacts
conoha server ssh hunyuan3d -- 'docker exec $(docker compose -f ~/apps/hunyuan3d-gpu/compose.yml ps -q hunyuan3d) nvidia-smi' > .artifacts/hunyuan3d-smoke-nvidia-smi.txt
conoha server ssh hunyuan3d -- 'cd ~/apps/hunyuan3d-gpu && docker compose logs --tail=300 hunyuan3d' > .artifacts/hunyuan3d-smoke-compose-logs.txt
```

These artifacts are local-only and ignored by git (see `.gitignore`'s `.worktrees/` precedent — add `.artifacts/` too if not already ignored).

---

### Task C6: Destroy the server

> **Pre-approved:** the user authorized destroy on smoke success during brainstorming.

- [ ] **Step 1: Final confirmation that smoke passed**

The previous task must have produced a non-zero GLB. If anything failed, stop and ask the user before destroying.

- [ ] **Step 2: Destroy**

```bash
conoha server destroy hunyuan3d --yes
```

Expected: server removed from `conoha server list`.

- [ ] **Step 3: Verify**

```bash
conoha server list | grep hunyuan3d || echo "destroyed cleanly"
```

Expected: `destroyed cleanly`.

---

## Phase D — Wrap-up

### Task D1: Summarize results to user

- [ ] **Step 1: Compose a short summary**

Report to the user:
- Sample committed (commit SHA)
- Smoke test outcome (elapsed shape generation time, GLB size)
- Server destroyed
- Suggest next step: open PR for `feat/hunyuan3d-gpu` (or whatever branch was used). **Do not open the PR yet** — confirm with the user first, since opening a PR is a shared-state action that wasn't explicitly pre-approved.

---

## Self-Review (writing-plans gate)

Before handing this to the executor, the planning agent verified:

- **Spec coverage:** Each spec section maps to a task — directory structure (A1), entrypoint (A2), Dockerfile (A3), compose (A4), README (A5), root registration (A6), validation (B1), smoke shape-only generation (C5/Step 2), GLB validity (C5/Step 3), known-limits documented (A5), license documented (A5), destroy after smoke (C6).
- **No placeholders:** every step contains the actual command or code. The one user-supplied value is `<KEY>` in C2/Step 1, which is read from the prior task output.
- **Type/name consistency:** sample dir is consistently `hunyuan3d-gpu`, server name `hunyuan3d`, model repo `tencent/Hunyuan3D-2`, port `7860`, image tag `hunyuan3d-gpu:local`, build pin `f8db63096c8282cb27354314d896feba5ba6ff8a` everywhere.
- **Known follow-up risk:** the `api_name` for shape generation in C5/Step 2 is best-guess — the plan documents how to enumerate endpoints if the guess is wrong, rather than failing silently.
