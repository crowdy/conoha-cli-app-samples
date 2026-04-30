# Hunyuan3D-2 GPU サンプル設計書

GitHub Issue: [#86](https://github.com/because-and/conoha-cli-app-samples/issues/86)

## 概要

ConoHa VPS3 の NVIDIA L4 GPU フレーバー上で **Tencent Hunyuan3D-2** を動作させ、1 枚の画像から GLB / OBJ の 3D モデルを生成するサンプルを追加する。Gradio WebUI を `7860` で公開し、ブラウザから画像→3D 化までを完結させる最小構成 (MVP) を提供する。

既存 GPU サンプル `fish-speech-tts-gpu` / `ollama-webui-gpu` のパターンを踏襲する。

## スコープ

本サンプルは MVP として以下を含む:

- M1: Dockerfile + entrypoint で WebUI が起動 (最小動作)
- M2: compose.yml で `conoha app deploy` 成功
- M3: README (GPU セットアップ + デプロイ + 動作確認)

以下は本 PR の対象外 (後続 PR 候補):

- FastAPI による REST API エンドポイント
- Go CLI クライアント
- Nano Banana 連携の "画像生成→3D 化" フロー README
- `conoha.yml` (subdomain proxy 経由公開)

## 主要決定事項

| 項目 | 決定 | 根拠 |
|------|------|------|
| モデルバージョン | Hunyuan3D-2 (オリジナル) | 24GB L4 で安定。論文・例題・コミュニティ資源最多。2.1 (PBR) は後続候補 |
| 公開方式 | Raw IP `:7860` 直接公開 (`conoha.yml` 無し) | `fish-speech-tts-gpu` 先例踏襲。DNS/proxy 依存ゼロでスモーク優先 |
| パッケージング | 自前 Dockerfile (Approach A) | 再現性優先。C++ 拡張をイメージに焼き、初回起動はモデル DL のみ |
| サーバーライフサイクル | スモーク成功後 `conoha server destroy` | L4 GPU 課金最小化 |
| GPU フレーバー | `g2l-t-c20m128g1-l4` (NVIDIA L4 24GB) | 本サンプル唯一の対応構成 |

## アーキテクチャ

### ディレクトリ構造

```
hunyuan3d-gpu/
├── compose.yml         # GPU 予約 + 7860 公開 + ボリューム 2 つ
├── Dockerfile          # PyTorch 2.4 + CUDA 12.4 ベース、C++ 拡張事前ビルド
├── entrypoint.sh       # モデル重みダウンロードガード + Gradio 起動
├── .dockerignore
└── README.md
```

`conoha.yml` / `cli/` は MVP では含めない。

### コンポーネント関係

```
Browser ──HTTP:7860──> [Hunyuan3D-2 Gradio app]
                              │
                              ├── /root/.cache/huggingface  (volume: hf_cache, ~10GB)
                              └── /app/outputs              (volume: outputs, GLB/OBJ)
                              │
                              └── L4 GPU (24GB VRAM, SM 8.9)
```

WebUI のみ公開。8080 API 等の追加ポートは MVP では露出しない。

## Docker 構成

### compose.yml

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

設計理由:

- `start_period: 900s` — 初回モデル DL (~10GB) を healthcheck failure 扱いしないため
- `TORCH_CUDA_ARCH_LIST=8.9` — L4 専用ビルドにすることでイメージサイズ・ビルド時間を削減
- ボリュームは 2 つに統合 (`hf_cache` と `outputs`)。issue 雛形の `model_data` は `hf_cache` と重複するため除外

### Dockerfile

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

設計理由:

- `HUNYUAN3D_REF` は build-arg として `main` 最新 SHA (`f8db630...`) を初期値で固定。再現性確保
- 公式 README の install 手順に従い `pip install -r requirements.txt` → `pip install -e .` → 各 texgen 拡張の `python3 setup.py install` の順で構築
- C++ 拡張 (`custom_rasterizer`, `differentiable_renderer`) を **イメージビルド時に焼き込む**。初回起動時の処理はモデル DL のみとなり、コンテナ再起動が高速化
- `huggingface_hub[cli]` + `hf_transfer` を追加 — entrypoint で `huggingface-cli download` を使い、~10GB ダウンロード時の速度を大幅改善
- `libgl1` / `libegl1` / `libgles2` は Hunyuan3D Paint 段階の OpenGL レンダラー要件

### entrypoint.sh

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

設計理由:

- **sentinel ファイルガード** (`fish-speech-tts-gpu` パターン) — 2 回目以降の起動はダウンロードをスキップし即時起動
- `huggingface-cli download` + `HF_HUB_ENABLE_HF_TRANSFER=1` の組み合わせで初回 DL を高速化
- `nvidia-smi` 出力を起動ログに残し、GPU 認識のトラブルシュートを容易に
- `exec python3 gradio_app.py` — Hunyuan3D-2 公式エントリポイント。リッスンアドレス・ポートは compose の env で 0.0.0.0:7860 に強制

## README 構造

`fish-speech-tts-gpu/README.md` を踏襲し、見出しは日本語。

```
# Hunyuan3D 2 (GPU)

## 概要
## 構成              (サービス表: WebUI 7860 のみ)
## 前提条件          (conoha-cli, SSH 鍵, flavor g2l-t-c20m128g1-l4)
## GPU セットアップ
   ### Step 1: サーバー作成
   ### Step 2: NVIDIA Container Toolkit
   ### Step 3: NVIDIA ドライバ
   ### Step 4: 再起動 + nvidia-smi 確認
## デプロイ          (conoha app deploy + 初回 ~15-20 分の説明)
## 動作確認          (WebUI アクセス + サンプル入力 + 生成時間目安)
## 既知の制限
## ライセンス        (Tencent Hunyuan Community License)
```

### 既知の制限 (README に明記)

- 入力画像推奨条件: 背景単色 / 透過 PNG、被写体中央
- VRAM OOM 時のフォールバック: texture を切って shape only モードに
- シリアル処理 (同時利用キュー無し)
- 透明素材・極端ポーズは苦手
- HTTPS 無し / 認証無し (本サンプルはスモーク用途)

### ライセンス記載

- Tencent Hunyuan Community License — 商用可 (月間アクティブユーザー 1 億未満)、出力物の商用利用可
- 公式 LICENSE へのリンク: https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE

## 動作確認 (スモーク) シナリオ

実装後、本リポジトリで以下を実機検証する:

1. `conoha server add --flavor g2l-t-c20m128g1-l4 --image ubuntu-24.04 ...` 成功
2. NVIDIA Container Toolkit + ドライバインストール後 `nvidia-smi` で L4 認識
3. `conoha app deploy hunyuan3d --app hunyuan3d-gpu` 成功
4. healthcheck **healthy** 到達 (目標 ≤20 分)
5. `curl http://<IP>:7860/` で 200 OK
6. WebUI で **同梱デモ画像** (`Hunyuan3D-2/assets/example_images/004.png` 等) → GLB 生成・ダウンロード成功 (shape only モードで 30-60 秒目安)
7. 生成 GLB が正常: `file output.glb` が "GLB binary"、サイズ > 0

成功条件達成後、`conoha server destroy hunyuan3d` でクリーンアップ。

## 既知の課題・リスク

- **モデル DL 時間**: `start_period: 900s` でも足りない可能性。失敗時は事前 `docker exec` での `huggingface-cli download` 手順を README に追記
- **C++ 拡張ビルド時間**: 初回 `docker build` で ~10 分かかるが、これはイメージ側に閉じる
- **L4 24GB のテクスチャ生成**: デフォルト解像度 (512) でも条件次第で OOM。README に "OOM 時は texture を切る" を明記
- **モデルレポジトリ変更リスク**: `tencent/Hunyuan3D-2` の構造変更で `huggingface-cli download` が壊れる可能性。`HUNYUAN3D_REF` を SHA pin することで上流コードと併せて固定

## 参考

- Hunyuan3D-2 リポジトリ: https://github.com/Tencent-Hunyuan/Hunyuan3D-2
- HuggingFace モデル: https://huggingface.co/tencent/Hunyuan3D-2
- 論文: https://arxiv.org/abs/2501.12202
- 既存 GPU サンプル: `fish-speech-tts-gpu`, `ollama-webui-gpu`
