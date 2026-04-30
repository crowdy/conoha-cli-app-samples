---
title: conoha-cliでTencent Hunyuan3D-2をNVIDIA L4 GPUにデプロイ — 画像から3Dモデルを27秒で生成
tags: ConoHa conoha-cli GPU 3D Hunyuan3D
author: crowdy
slide: false
---
## はじめに

Nano Banana や Gemini 2.5 Flash Image のような画像生成 AI で「これを 3D プリンタで出したい」「VRChat のアバターに使いたい」と思ったことはありませんか。今や 1 枚の画像から 3D モデルを生成する SaaS（[Meshy](https://www.meshy.ai/)、[Tripo3D](https://www.tripo3d.ai/)、[Rodin](https://hyperhuman.deemos.com/rodin) など）はかなり充実していますが、**入力画像をクラウドに送る抵抗感**、**月額のサブスク縛り**、**API レート制限** が気になることがあります。

そこで今回は、Tencent が公開しているオープンソースの画像 → 3D 生成モデル **[Tencent Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)** を、ConoHa VPS3 の **NVIDIA L4 GPU** フレーバーにデプロイしてみました。デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使い、サーバー作成から `docker compose up` まですべてターミナルから完結させています。

実機で 1 枚の画像から **shape only モードで 27 秒** で GLB が出てくることを確認しています。本記事では、その手順と、検証中に踏んだ **2 件の罠**（`huggingface-cli` 廃止 / `gradio_app.py` の `GRADIO_SERVER_*` 環境変数が効かない）を共有します。

---

## Hunyuan3D-2 とは

[Tencent Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) は Tencent の Hunyuan チームが公開している、**1 枚の画像から 3D メッシュ + テクスチャ** を生成する大規模 3D 拡散モデルです（[論文](https://arxiv.org/abs/2501.12202)）。

| 特徴 | 説明 |
|------|------|
| **2 段階パイプライン** | Hunyuan3D-DiT で形状（mesh）→ Hunyuan3D-Paint でテクスチャ |
| **入力 1 枚 / 多視点両対応** | 単一画像でも複数視点画像でも入力可 |
| **GLB / OBJ / PLY 出力** | trimesh ベースなので各種 3D フォーマットに変換可能 |
| **Gradio WebUI 同梱** | ブラウザから画像をアップロードするだけ |
| **Tencent Hunyuan Community License** | **商用利用可**（月間 MAU 1 億未満） |

PBR テクスチャ対応の後継版 [Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) もありますが、L4 24GB での安定性とコミュニティ資源の多さを優先して、まずは無印 Hunyuan3D-2 を使います。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Hunyuan3D-2**（commit `f8db630`） | 画像 → 3D 生成モデル |
| **Gradio WebUI** | ブラウザから画像をアップロード |
| **PyTorch 2.4 + CUDA 12.4** | ベースイメージ（`pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel`） |
| **NVIDIA L4 GPU** | 推論用 GPU（24GB VRAM、SM 8.9） |
| **ConoHa VPS3** `g2l-t-c20m128g1-l4` | 20 vCPU / 128GB RAM / L4 24GB |
| **conoha-cli** | ターミナルから VPS 操作 |

### アーキテクチャ

```
ブラウザ
  ↓ HTTP :7860
Hunyuan3D-2 Gradio WebUI (uvicorn)
  ├── /shape_generation       → 画像 → メッシュ (DiT)
  ├── /generation_all         → 画像 → メッシュ + テクスチャ (DiT + Paint)
  └── /on_export_click        → GLB/OBJ/PLY/STL 書き出し
       │
       ├── /root/.cache/huggingface  ← モデル重み (~10GB)
       └── /app/outputs              ← 生成 GLB
```

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するための CLI ツールです。Web コンソールでマウス操作を繰り返す代わりに、`compose.yml` のあるディレクトリで 1 コマンド叩けば VPS が立ち上がってアプリが動く、という体験を目指しています。

### 主な機能

- **サーバー管理**: VPS の作成・削除・一覧・SSH 接続
- **app deploy**: `compose.yml` があるディレクトリを tar してアップロード → `docker compose up -d` まで一気通貫
- **app logs / status**: コンテナログの参照と稼働状態確認
- **DNS / ボリューム / キーペア / セキュリティグループ** など ConoHa の主要リソースを一通りカバー

GPU プランも普通の VPS と同じインタフェースで扱えるので、本記事のように `--flavor g2l-t-c20m128g1-l4` を渡すだけで L4 GPU サーバーが手に入ります。

---

## 構成ファイル（`hunyuan3d-gpu/`）

サンプルは [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples) の `hunyuan3d-gpu/` にあります。中身は 4 つだけです。

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

`start_period: 900s` は初回モデル DL（~10GB）を healthcheck failure 扱いさせないためです。`TORCH_CUDA_ARCH_LIST=8.9` は L4 専用ビルド指定で、C++ 拡張のコンパイル時間を短縮します。

### Dockerfile（要点）

公式 README の install 手順に沿って、`requirements.txt` → `pip install -e .` → `hy3dgen/texgen/` 配下の C++ 拡張を `python3 setup.py install` でビルドします。重要なのは **イメージビルド時に C++ 拡張を焼き込んでおく** ことで、初回起動時の処理がモデル DL のみに絞られます。

```dockerfile
FROM pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel
ENV TORCH_CUDA_ARCH_LIST=8.9 \
    HF_HUB_ENABLE_HF_TRANSFER=1
# ... apt 依存 ...
ARG HUNYUAN3D_REF=f8db63096c8282cb27354314d896feba5ba6ff8a
RUN git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git . \
    && git checkout ${HUNYUAN3D_REF}
RUN pip install -r requirements.txt \
    && pip install -e . \
    && pip install "huggingface_hub[cli]" hf_transfer
RUN cd /app/hy3dgen/texgen/custom_rasterizer && python3 setup.py install \
 && cd /app/hy3dgen/texgen/differentiable_renderer && python3 setup.py install
COPY entrypoint.sh /entrypoint.sh
EXPOSE 7860
ENTRYPOINT ["/entrypoint.sh"]
```

### entrypoint.sh

sentinel ファイルガードで 2 回目以降の起動はモデル DL をスキップします。後述の罠を踏んだ修正版です。

```bash
#!/usr/bin/env bash
set -euo pipefail

MODEL_REPO="${MODEL_REPO:-tencent/Hunyuan3D-2}"
MODEL_DIR="${HF_HOME:-/root/.cache/huggingface}/hub/models--${MODEL_REPO//\//--}"
SENTINEL="$MODEL_DIR/.download_complete"

mkdir -p /app/outputs "$MODEL_DIR"

if [ ! -f "$SENTINEL" ]; then
    hf download "$MODEL_REPO"
    touch "$SENTINEL"
fi

exec python3 gradio_app.py --host 0.0.0.0 --port 7860 --cache-path /app/outputs
```

---

## デプロイ手順

### Step 1: L4 GPU サーバーの作成

```bash
conoha server create \
  --name hunyuan3d \
  --flavor g2l-t-c20m128g1-l4 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name my-key \
  --security-group IPv4v6-SSH \
  --security-group 3000-9999 \
  --yes --wait
```

Docker プリインストール済みの `vmi-docker` を使うと、Docker 自体のインストール手順をまるごと省略できます。`3000-9999` セキュリティグループは Gradio が listen する `7860` を許可するためです。

### Step 2: NVIDIA Container Toolkit + ドライバ

`fish-speech-tts-gpu` と同じ手順なので詳細は割愛しますが、SSH ログイン後に NVIDIA Container Toolkit と GPU ドライバをインストール → 再起動 → `nvidia-smi` で `NVIDIA L4` が見えれば OK です。

実機では `Driver Version: 595.58.03 / CUDA Version: 13.2` を確認しました（コンテナ内の PyTorch は CUDA 12.4 を使用するので、ドライバ側 CUDA とは独立）。

### Step 3: アプリデプロイ

ローカルに戻って、サンプルディレクトリからデプロイします。

```bash
cd conoha-cli-app-samples/hunyuan3d-gpu
conoha app deploy hunyuan3d --app-name hunyuan3d-gpu
```

初回は **Docker build が ~10 分**、起動後の **モデル DL（~10GB）が ~8 分** かかり、`healthy` 到達まで合計 **~18 分** でした。2 回目以降はモデル DL がスキップされて即起動します。

### Step 4: 動作確認

ブラウザで `http://<サーバーIP>:7860` にアクセスすると Hunyuan3D-2 の Gradio WebUI が表示されます。サンプル画像（`assets/example_images/004.png`）をアップロードして「Gen Shape」を押すだけで GLB が出てきます。

実機で `gradio_client` から `/shape_generation` を叩いた結果：

```
shape_generation elapsed: 27.0s
faces:    410,162
vertices: 205,073
output:   /app/outputs/<uuid>/white_mesh.glb (7.4 MB, glTF 2.0 valid)
```

L4 GPU 1 台で **画像 1 枚 → 3D メッシュが 27 秒**。生成された GLB は [glTF Viewer](https://gltf-viewer.donmccurdy.com/) や Blender で開いて確認できます。

---

## ハマりポイント

### 罠 1: `huggingface-cli` は `huggingface_hub >= 1.x` で廃止

公式 README や fish-speech 系のサンプルにも残っている `huggingface-cli download <repo>` ですが、最新の `huggingface_hub`（1.x 系）では **CLI が廃止されて非ゼロ終了** します。

```
Warning: `huggingface-cli` is deprecated and no longer works. Use `hf` instead.
Hint: `hf` is already installed! Use it directly.
```

何が困るかというと、entrypoint で `set -euo pipefail` をかけていると、この非ゼロ終了で entrypoint プロセスが死に → docker が `restart: unless-stopped` で再起動 → 再び死亡、を延々と繰り返します。コンテナのステータスは `unhealthy / restarting / RestartCount=N` がじわじわ増えていく挙動になります。

修正は単純で、`huggingface-cli download` を `hf download` に置き換えるだけです。同じ `huggingface_hub[cli]` パッケージから両方のコマンドが提供されていますが、新コマンドの `hf` のみが今後メンテされます。

### 罠 2: `gradio_app.py` は `uvicorn.run()` で起動するので env vars が効かない

最初は compose.yml で `GRADIO_SERVER_NAME=0.0.0.0` / `GRADIO_SERVER_PORT=7860` を指定していましたが、デプロイ後にコンテナの listen ポートがなぜか **8080** になっていてヘルスチェックが永遠に通らない、という現象に悩まされました。

原因は `gradio_app.py` の最後を見ると一発で分かります。

```python
uvicorn.run(app, host=args.host, port=args.port, workers=1)
```

このアプリは `demo.launch()` ではなく **`uvicorn.run()` で起動している** ため、Gradio の `GRADIO_SERVER_*` 環境変数は完全に無視されます。`argparse` の既定値（`--port 8080` / `--cache-path gradio_cache`）が支配します。

修正は entrypoint で明示的に渡すこと：

```bash
exec python3 gradio_app.py --host 0.0.0.0 --port 7860 --cache-path /app/outputs
```

`--cache-path /app/outputs` を入れると、生成された GLB がちゃんとマウントしたボリュームに落ちるようになります（既定の `gradio_cache` だと相対パスでコンテナ内の `/app/gradio_cache/` に落ちて、ボリュームに反映されません）。

---

## SaaS との比較

3D 生成 SaaS は手軽ですが、課金体系がクレジット制（生成 1 回あたり数〜数十クレジット消費）でサブスク縛りになりがちです。「**今月だけ大量に生成したい**」「**入力画像を外部に出したくない**」「**API レート上限に縛られたくない**」というケースでは、ConoHa L4 の **時間課金（¥169/時、Standard L4）** で必要なときだけ立てて使い、終わったら destroy するパターンが効きます。

| ユースケース | おすすめ |
|---|---|
| 月数回〜十数回程度の生成 | **SaaS**（Meshy / Tripo3D 等） |
| 大量バッチ（数百〜数千） | **ConoHa L4 自前運用** |
| 入力画像を外部に出せない | **ConoHa L4 自前運用** |
| 短期集中（週末だけなど） | **ConoHa L4 時間課金** |

実機検証では shape only で 27 秒だったので、1 時間あれば理論上 100 〜 130 個のメッシュを連続生成できます（実運用では順番待ちと別途 I/O が入るので 50 〜 80 個程度が現実的）。テクスチャ込みでも 1 〜 2 分なので、1 時間あたりの生成数で見ると SaaS のクレジット制と比べて圧倒的に得になるケースがあります。

---

## まとめ

- ConoHa VPS3 の NVIDIA L4 GPU + Docker プリインストールイメージ + conoha-cli の組み合わせで、**Tencent Hunyuan3D-2 を 18 分でデプロイし、画像 → 3D メッシュを 27 秒で生成** できることを実機で確認しました
- C++ 拡張をイメージビルド時に焼き込み、モデル重みは sentinel ガード付きで永続ボリュームにキャッシュする設計にしておくと、2 回目以降の起動が即時化します
- 罠 1（`huggingface-cli` 廃止）と罠 2（`gradio_app.py` の env vars が効かない）は、両方とも `set -euo pipefail` のおかげで早期に表面化したので、エントリポイントの `set -e` は省略しないことをおすすめします
- **3D モデル制作を業務でやっている方** や、**入力画像を外部に出さずに大量生成したい方** には、SaaS の代替として十分に実用的だと感じました

サンプルコードは [crowdy/conoha-cli-app-samples/hunyuan3d-gpu](https://github.com/crowdy/conoha-cli-app-samples/tree/main/hunyuan3d-gpu) にあります。

---

### 参考

- [Tencent Hunyuan3D-2 - GitHub](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)
- [Hunyuan3D-2 - HuggingFace](https://huggingface.co/tencent/Hunyuan3D-2)
- [Hunyuan3D 2.0 論文 (arXiv:2501.12202)](https://arxiv.org/abs/2501.12202)
- [Tencent Hunyuan Community License](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE)
- [ConoHa VPS3 GPU プラン](https://vps.conoha.jp/gpu/)
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
