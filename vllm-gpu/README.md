# vllm-gpu

NVIDIA L4 GPU フレーバーで [vLLM](https://github.com/vllm-project/vllm) による **OpenAI 互換 LLM 推論サーバー**をデプロイするサンプル。Caddy でリバースプロキシし、`/v1/chat/completions` などをそのまま叩けます。

## このサンプルの位置づけ

| サンプル | 想定読者 | API | 同時実行 |
|---|---|---|---|
| [`ollama-webui-gpu`](../ollama-webui-gpu/) | エンドユーザー | Ollama 独自 + WebUI | 直列 |
| **`vllm-gpu`（本サンプル）** | バックエンド開発者 | OpenAI 互換 `/v1/*` | PagedAttention によるバッチ |

## 構成

| サービス | ポート | 説明 |
|---|---|---|
| vLLM | 8000（内部のみ） | OpenAI 互換推論サーバー |
| Caddy | 80, 443 | HTTPS 終端・リバースプロキシ |

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) インストール済み
- ConoHa VPS3 アカウント + SSH キーペア
- **L4 GPU フレーバー**（`g2l-*-l4` 系）
- NVIDIA ドライバ 535 以上 / CUDA 12.1 以上

## GPU 環境のセットアップ

`ollama-webui-gpu` などと同じ手順です。

```bash
# Step 1: NVIDIA Container Toolkit
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Step 2: NVIDIA Driver
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu

# Step 3: Reboot
sudo reboot

# Step 4: 確認
sudo apt install -y nvidia-utils-570-server
nvidia-smi
```

## デプロイ

```bash
# サーバー作成
conoha server add --flavor g2l-t-c20m128g1-l4 --image ubuntu-24.04 \
  --key mykey --name vllm-gpu

# 上記の GPU セットアップを実施

# .env を編集（任意。最初はデフォルトのまま動かしても良い）
# scp や conoha server ssh で .env を作成

# デプロイ（初回はモデル DL で 5–20 分、healthcheck の start_period は 1200 秒）
# Caddy が 80/443 を直接公開するため、`conoha app init`（conoha-proxy 経由の
# blue/green 配置）は使わず、`conoha app deploy` のみで運用します。
conoha app deploy vllm-gpu --app-name vllm-gpu \
  --identity ~/.ssh/conoha_mykey --no-input
```

## 動作確認

```bash
# サーバー側で
docker compose ps      # vllm: healthy / caddy: running

# ローカルから
BASE_URL=http://<サーバーIP> bash scripts/smoke-test.sh
# → [1/3] ok / [2/3] ok / [3/3] ok
# → All 3 endpoints responded successfully.
```

OpenAI SDK からも普通に呼べます:

```python
from openai import OpenAI
client = OpenAI(base_url="http://<サーバーIP>/v1", api_key="<VLLM_API_KEY または empty>")
r = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "Hello"}],
)
print(r.choices[0].message.content)
```

## ベンチマーク

```bash
BASE_URL=http://<サーバーIP> bash scripts/benchmark.sh
```

L4 24GB 単体で `Qwen2.5-7B-Instruct-AWQ` を動かした実測値（参考、要更新）:

| 指標 | 値 |
|---|---|
| 単一リクエストスループット | TBD tok/s |
| 同時 16 リクエスト合計 | TBD tok/s |
| TTFT p50 | TBD ms |
| TPOT p50 | TBD ms |

> **注**: ベンチマーク実測後、Task 9 で実数値に置き換えてください。

## カスタマイズ

### モデルを変更する

`.env` の `MODEL_NAME` をコメント切替:

```bash
# 軽量・高速
MODEL_NAME=Qwen/Qwen2.5-7B-Instruct-AWQ

# 高品質・KV キャッシュは余裕少
MODEL_NAME=Qwen/Qwen2.5-32B-Instruct-AWQ
```

### HTTPS を有効化

DNS で `vllm.example.com` をサーバー IP に向け、`.env` に:

```bash
DOMAIN_NAME=vllm.example.com
```

Caddy が自動で Let's Encrypt 証明書を取得します。

### API キーで保護

```bash
VLLM_API_KEY=$(openssl rand -hex 32)
```

`/v1/*` への全リクエストに `Authorization: Bearer <key>` が必須になります。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `CUDA out of memory` | `MAX_MODEL_LEN` を減らす（8192→4096）か `GPU_MEMORY_UTILIZATION` を 0.85 に下げる |
| `model not found` | HF gated モデル（Llama 系）は `HF_TOKEN` 必須 |
| AWQ kernel エラー | `QUANTIZATION=awq` に切替（marlin が動かない古い GPU 用フォールバック）|
| `nvidia-smi` がない | Step 4 の `nvidia-utils-570-server` インストールを実施 |
| ヘルスチェック失敗で再起動ループ | 初回モデル DL の途中。`docker compose logs vllm` で進捗確認、20 分は待つ |

## 関連リンク

- [vLLM 公式](https://github.com/vllm-project/vllm)
- [Qwen2.5 モデル](https://huggingface.co/Qwen)
- [`ollama-webui-gpu`](../ollama-webui-gpu/)（個人向けチャット UI 版）
- [`fish-speech-tts-gpu`](../fish-speech-tts-gpu/)（同じ L4 で TTS）
