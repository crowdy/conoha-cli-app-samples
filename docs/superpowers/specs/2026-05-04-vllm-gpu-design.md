# vLLM GPU サンプル設計書

## 概要

ConoHa VPS3 の NVIDIA L4 GPU フレーバーを使用して、vLLM による OpenAI 互換の LLM 推論サーバーをデプロイするサンプル。`ollama-webui-gpu` がエンドユーザー向けチャット UI を提供するのに対し、本サンプルはバックエンド開発者向けに **OpenAI 互換 API（`/v1/chat/completions`）** を提供し、複数同時リクエストでのスループットを重視する。

## 既存サンプルとの位置づけ

| サンプル | 想定読者 | API | 同時実行 | 量子化 |
|---|---|---|---|---|
| `ollama-webui-gpu` | エンドユーザー | Ollama 独自 + WebUI | 直列処理 | GGUF (CPU 寄り) |
| **`vllm-gpu` (本サンプル)** | バックエンド開発者 | OpenAI 互換 `/v1/*` | PagedAttention によるバッチ | AWQ / GPTQ / FP8 |

両者は競合せず補完関係。

## アーキテクチャ

### アプローチ

公式 Docker イメージ `vllm/vllm-openai:latest` をベースに、リバースプロキシ Caddy で HTTPS 終端を行う最小構成。モデルは初回起動時に HuggingFace から自動ダウンロード。

### サービス構成

| サービス | コンテナ | ポート | 役割 |
|---|---|---|---|
| vllm | `vllm/vllm-openai:latest` | 8000 (内部) | OpenAI 互換推論サーバー |
| caddy | `caddy:2-alpine` | 80, 443 | HTTPS リバースプロキシ |

### ディレクトリ構造

```
vllm-gpu/
├── compose.yml
├── Caddyfile
├── .env.example
├── scripts/
│   ├── smoke-test.sh           # OpenAI 互換 API の疎通確認
│   └── benchmark.sh            # vllm benchmark_serving ラッパー
├── README.md                   # 日本語（リポジトリ標準）
├── README-ko.md                # 韓国語
├── README-en.md                # 英語
└── .dockerignore
```

## デフォルト設定

### モデル選定

**デフォルト**: `Qwen/Qwen2.5-7B-Instruct-AWQ`

理由:
- AWQ INT4 量子化で約 9 GB → KV キャッシュに約 12 GB の余裕（24GB L4 想定）
- 多言語サポート（日・英・韓・中）— ConoHa の主要市場と一致
- Apache 2.0 互換ライセンス、HuggingFace トークン不要
- vLLM が公式に AWQ + Marlin カーネルで最適化対応

### オプション切り替え

`.env.example` で以下を切り替え可能:

```bash
# モデル切り替え（コメントアウトで切り替え）
MODEL_NAME=Qwen/Qwen2.5-7B-Instruct-AWQ           # デフォルト・軽量
# MODEL_NAME=Qwen/Qwen2.5-32B-Instruct-AWQ        # 高品質・KV 余裕少
# MODEL_NAME=meta-llama/Llama-3.1-8B-Instruct     # HF_TOKEN 必須
# MODEL_NAME=google/gemma-2-9b-it                 # Gemma 系

# vLLM ランタイムパラメータ
MAX_MODEL_LEN=8192
GPU_MEMORY_UTILIZATION=0.90
DTYPE=auto                                        # auto | half | bfloat16
QUANTIZATION=awq_marlin                           # awq_marlin | gptq | fp8 | none

# 認証（Bearer Token）
VLLM_API_KEY=                                     # 空ならノーガード（外向け禁止）

# HuggingFace（gated モデル使用時のみ）
HF_TOKEN=
```

## Docker 構成

### compose.yml（要点）

```yaml
services:
  vllm:
    image: vllm/vllm-openai:latest
    command: >
      --model ${MODEL_NAME}
      --max-model-len ${MAX_MODEL_LEN}
      --gpu-memory-utilization ${GPU_MEMORY_UTILIZATION}
      --quantization ${QUANTIZATION}
      --dtype ${DTYPE}
      --api-key ${VLLM_API_KEY:-}
      --served-model-name default
    environment:
      - HUGGING_FACE_HUB_TOKEN=${HF_TOKEN:-}
    volumes:
      - hf_cache:/root/.cache/huggingface
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 30
      start_period: 1200s     # 初回はモデル DL（数 GB）+ ウォームアップで最大 20 分
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      vllm:
        condition: service_healthy
    restart: unless-stopped

volumes:
  hf_cache:
  caddy_data:
  caddy_config:
```

### Caddyfile

```caddy
{$DOMAIN_NAME:":80"} {
    reverse_proxy vllm:8000
    encode gzip
    log {
        output stdout
        format json
    }
}
```

`DOMAIN_NAME` 未設定なら HTTP（80）のみ。設定すれば Caddy 自動 ACME で HTTPS 化。

## テスト戦略

### smoke-test.sh

OpenAI 互換 API の 3 エンドポイントを順に叩く:

```bash
# 1. /v1/models が default を返す
curl -fsS -H "Authorization: Bearer $VLLM_API_KEY" \
  http://localhost/v1/models | jq -e '.data[0].id == "default"'

# 2. /v1/chat/completions が 200 + 非空 content
curl -fsS -X POST http://localhost/v1/chat/completions \
  -H "Authorization: Bearer $VLLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"hello"}],"max_tokens":16}' \
  | jq -e '.choices[0].message.content | length > 0'

# 3. /v1/completions（旧 API 互換）も疎通確認
curl -fsS -X POST http://localhost/v1/completions \
  -H "Authorization: Bearer $VLLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"default","prompt":"The capital of Japan is","max_tokens":8}' \
  | jq -e '.choices[0].text | length > 0'
```

3 つすべて 0 で抜けたら成功。

### benchmark.sh

vLLM 公式の `benchmark_serving.py` を Docker 内で実行:

```bash
docker compose exec vllm python -m vllm.entrypoints.openai.api_server.benchmarks.benchmark_serving \
  --backend openai \
  --base-url http://localhost:8000 \
  --model default \
  --dataset-name random \
  --num-prompts 200 \
  --request-rate 8 \
  --random-input-len 512 \
  --random-output-len 256
```

出力: スループット（req/s, tok/s）、TTFT、TPOT、p50/p99 レイテンシ。
README に **L4 1 枚での実測値**を記載。

## GPU セットアップ

`ollama-webui-gpu` / `fish-speech-tts-gpu` と同じパターンを使用:

1. NVIDIA Container Toolkit インストール
2. NVIDIA Driver インストール（`ubuntu-drivers install --gpgpu`）
3. 再起動
4. `nvidia-utils-570-server` + `nvidia-smi` で確認

これらは README にコピペ可能なコマンドブロックとして提示。

## デプロイフロー

```
1. conoha server add --flavor <L4 フレーバー> --image ubuntu-24.04 --key mykey --name vllm-gpu
2. conoha server ssh vllm-gpu
   → NVIDIA Container Toolkit + Driver インストール
3. conoha server reboot vllm-gpu --wait
4. conoha server ssh vllm-gpu → nvidia-smi 確認
5. conoha app init vllm-gpu --app-name vllm-gpu
6. conoha app deploy vllm-gpu --app-name vllm-gpu
   → 初回はモデル DL（5–20 分）→ サーバー起動 → healthcheck OK
7. bash scripts/smoke-test.sh   → 3 エンドポイント疎通
8. bash scripts/benchmark.sh    → スループット計測（任意）
```

## README 多言語化

リポジトリの既存規約は日本語 README 単一だが、本サンプルは多言語読者を想定して:

- `README.md`（日本語、リポジトリ標準）
- `README-ko.md`（韓国語）
- `README-en.md`（英語）

3 ファイルとも同じ章立て:

1. タイトル + 簡潔な説明
2. 既存サンプルとの位置づけ表
3. 前提条件
4. GPU セットアップ
5. デプロイ
6. 動作確認（smoke-test）
7. ベンチマーク（実測値表）
8. カスタマイズ（モデル切替、API キー、ドメイン、量子化）
9. トラブルシューティング（OOM、driver mismatch、AWQ kernel エラー）
10. 関連リンク

## 注意事項（README 明記）

1. **NVIDIA Driver 535 以上、CUDA 12.1 以上**が必要
2. **AWQ 32B 系を選んだ場合のディスク要件**: 50GB 以上
3. **FP8 attention は Hopper (H100) 専用**で L4 では効かない（自動フォールバック）
4. **`--max-model-len` を 32k 以上にすると OOM のリスク**: KV キャッシュサイズが二乗で増える
5. **API キー未設定で外向けに公開しない**こと（コスト不正利用防止）

## 後続サンプル（別計画）

`n8n-mcp` サンプル（n8n + MCP サーバー）を別 spec/plan として後日追加予定。本サンプルとは独立。
