---
title: conoha-cliでFish Speech TTSをNVIDIA L4 GPUにデプロイ
tags: ConoHa conoha-cli TTS GPU FishSpeech
author: crowdy
slide: false
---
## はじめに

「テキストから自然な音声を生成したい」——この需要に対して、OpenAI TTS や Google Cloud TTS などの商用APIを使うのが最も手軽な選択肢です。しかし、**音声クローニング**（参照音声を元に特定の声で読み上げる）や、**大量バッチ生成**となると、商用APIでは対応できなかったりコストが跳ね上がったりします。

そこで今回は、オープンソースのTTSエンジン **[Fish Speech](https://speech.fish.audio/)** を ConoHa VPS3 の **NVIDIA L4 GPU** フレーバーにデプロイしてみました。デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使い、GPU ドライバのセットアップからアプリ起動まで、すべてターミナルから実行しています。

この記事では、デプロイ手順に加えて、**商用 TTS API との料金比較**、そして本当は使いたかった **Fish Audio S2 Pro モデルが Docker イメージのバグで動かなかった話**を共有します。

---

## Fish Speech とは

[Fish Speech](https://github.com/fishaudio/fish-speech) は、Fish Audio が開発するオープンソースの音声合成（TTS）エンジンです。

| 特徴 | 説明 |
|------|------|
| **多言語対応** | 日本語・韓国語・英語・中国語など多数の言語に対応 |
| **音声クローニング** | 10〜30秒の参照音声だけで特定の声を再現（ファインチューニング不要） |
| **Gradio WebUI** | ブラウザから直接音声生成が可能 |
| **REST API** | `/v1/tts` エンドポイントでプログラマティックに利用可能 |

現在公開されている最新モデル **S2 Pro**（4Bパラメータ）はベンチマーク総合1位級の性能で、80以上の言語をサポートしています。ただし後述の通り、Docker イメージの不具合により S2 Pro は現時点では利用できず、今回は **Fish Speech 1.5** モデルでのデプロイとなります。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Fish Speech v1.5.1** | TTSエンジン（Dockerイメージ） |
| **fish-speech-1.5 モデル** | TTS用学習済みモデル |
| **NVIDIA L4 GPU** | 推論用GPU（24GB VRAM） |
| **ConoHa VPS3** | GPU付きVPSインスタンス |
| **conoha-cli** | ターミナルからVPS操作するCLI |

### アーキテクチャ

```
ブラウザ / CLI
  ↓
Fish Speech (:7860)
  ├── Gradio WebUI   → テキスト入力 → WAV音声生成
  └── 内部推論
       ├── DualAR Transformer（テキスト → VQトークン）
       └── VQ-GAN デコーダ（VQトークン → 音声波形）
```

GPU メモリ使用量は約 **1.75 GB**（fish-speech-1.5 モデルの場合）。L4 の 24GB VRAM に対してかなり余裕があり、CPU でも動作可能な軽さです。

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するためのCLIツールです。

### 主な機能

- **サーバー管理**: VPSの作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリをVPSにデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認

---

## デプロイ手順

### Step 1: L4 GPU サーバーの作成

```bash
conoha server create \
  --name fish-speech \
  --flavor g2l-t-c20m128g1-l4 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name my-key \
  --security-group default \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --yes --wait
```

Docker プリインストール済みのイメージ（`vmi-docker`）を使うと、`app init` 時の Docker インストールがスキップされて少し速くなります。

### Step 2: NVIDIA ドライバのインストール

GPU サーバーを作成したら、SSH でログインして NVIDIA Container Toolkit とドライバをインストールします。

```bash
conoha server ssh fish-speech
```

```bash
# NVIDIA Container Toolkit
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# NVIDIA ドライバ
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu
```

### Step 3: サーバー再起動 & 確認

```bash
exit
conoha server reboot fish-speech
# 再起動後
conoha server ssh fish-speech
sudo apt install -y nvidia-utils-570-server
nvidia-smi
```

以下のように L4 GPU が認識されていれば OK です。

```
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 570.211.01             Driver Version: 570.211.01     CUDA Version: 12.8     |
|   0  NVIDIA L4                      Off |   00000000:00:06.0 Off |                    0 |
| N/A   41C    P0             28W /   72W |       0MiB /  23034MiB |      0%      Default |
+-----------------------------------------------------------------------------------------+
```

### Step 4: モデルのダウンロード

Fish Speech のモデルはゲート付き（HuggingFace ライセンス承認が必要）の場合があります。事前にモデルをダウンロードしておきます。

```bash
# サーバー上で実行
docker run --rm \
  -v fish-speech-tts-gpu_model_data:/app/checkpoints \
  -e HF_TOKEN=<your-huggingface-token> \
  --entrypoint bash \
  fishaudio/fish-speech:webui-cuda \
  -c "uv run hf download fishaudio/fish-speech-1.5 --local-dir /app/checkpoints/fish-speech-1.5"
```

### Step 5: アプリデプロイ

ローカルに戻って、サンプルディレクトリからデプロイします。

```bash
cd conoha-cli-app-samples/fish-speech-tts-gpu

conoha app init fish-speech --app-name fish-speech-tts-gpu
conoha app deploy fish-speech --app-name fish-speech-tts-gpu
```

`compose.yml` はこのようになっています。

```yaml
services:
  fish-speech:
    image: fishaudio/fish-speech:v1.5.1
    ports:
      - "7860:7860"
    volumes:
      - model_data:/app/checkpoints
      - references:/app/references
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    environment:
      - HF_TOKEN=${HF_TOKEN}
      - LLAMA_CHECKPOINT_PATH=checkpoints/fish-speech-1.5
      - DECODER_CHECKPOINT_PATH=checkpoints/fish-speech-1.5/firefly-gan-vq-fsq-8x1024-21hz-generator.pth
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7860/health"]
      interval: 30s
      timeout: 10s
      retries: 20
      start_period: 600s
    restart: unless-stopped

volumes:
  model_data:
  references:
```

### Step 6: 動作確認

ブラウザで `http://<サーバーIP>:7860` にアクセスすると、Gradio WebUI が表示されます。

「Input Text」にテキストを入力して「Generate」ボタンを押すと、数秒で音声が生成されます。日本語・韓国語・英語いずれも自然な音声が出力されました。

起動ログでは、Warmup 時の性能が確認できます。

```
Decoded text: Hello world.
Generated 31 tokens in 2.24 seconds, 13.86 tokens/sec
Bandwidth achieved: 8.84 GB/s
GPU Memory used: 1.75 GB
Warming up done, launching the web UI...
```

---

## ハマりポイント: S2 Pro モデルが動かない

今回の最大のハマりポイントです。

本来は **Fish Audio S2 Pro** モデル（4B パラメータ、ベンチマーク総合1位級、80以上の言語に対応）を使いたかったのですが、**Docker イメージのバグにより S2 Pro および openaudio-s1-mini モデルは現時点では動作しません**。

### エラーの内容

```
AttributeError: 'NoneType' object has no attribute 'encode'
```

### 原因

1. S2 Pro / openaudio-s1-mini は `dual_ar` アーキテクチャを使用
2. Docker イメージ内の `FishTokenizer` が `AutoTokenizer` 経由でトークナイザーを読み込もうとする
3. `transformers` ライブラリが `dual_ar` モデルタイプを認識できず、読み込み失敗
4. トークナイザーが `None` のまま残り、テキストエンコード時にクラッシュ
5. **フォールバック機構が実装されていない**（tiktoken への切り替えなし）

### 試したイメージ

| Docker イメージ | 結果 |
|---|---|
| `fishaudio/fish-speech:webui-cuda` (latest) | tokenizer エラー |
| `fishaudio/fish-speech:webui-cuda-nightly` | 同じエラー |
| `fishaudio/fish-speech:webui-cuda-v2.0.0-beta` | `UnboundLocalError` 別バグ |
| **`fishaudio/fish-speech:v1.5.1`** + fish-speech-1.5 | **✅ 正常動作** |

この問題は GitHub Issue [fishaudio/fish-speech#1266](https://github.com/fishaudio/fish-speech/issues/1266) として報告されており、2026年4月時点で未解決です。修正がリリースされ次第、S2 Pro モデルに切り替える予定です。

---

## コスト比較: 商用 TTS API vs ConoHa L4 自前運用

自前で TTS サーバーを立てる意味があるのか、商用 API と料金を比較してみました。

### 商用 API 価格

| サービス | 料金 | 1万文字あたり |
|---|---|---|
| OpenAI TTS (`tts-1`) | $15 / 100万文字 | 約 ¥2.3 |
| OpenAI TTS HD (`tts-1-hd`) | $30 / 100万文字 | 約 ¥4.5 |
| Google Cloud TTS (Neural) | $16 / 100万文字 | 約 ¥2.4 |
| Amazon Polly (Neural) | $16 / 100万文字 | 約 ¥2.4 |

### ConoHa L4 GPU 価格

| プラン | 月額 | 時間課金 |
|---|---|---|
| Compact L4 (4vCPU/16GB) | ¥39,930/月 | ¥66.6/時 |
| Standard L4 (20vCPU/128GB) | ¥99,220/月 | ¥169/時 |

### 損益分岐点

OpenAI TTS（`tts-1`）と Compact L4 で比較すると：

```
月額 ¥39,930 ÷ ¥2.3/万文字 ≈ 1,735万文字/月
```

**月に約 1,735 万文字（≈ 8,700 ページ分）** を超えるなら自前 L4 が得になります。

### 利用量別のおすすめ

| 利用量 | おすすめ |
|---|---|
| 少量（月数万文字） | **商用 API** が圧倒的に安い（数十円〜数百円） |
| 中量（月数百万文字） | **商用 API**（数千円 vs ¥39,930） |
| 大量（月1,700万文字超） | **ConoHa L4** |
| 必要な時だけ使いたい | **ConoHa L4 時間課金**（¥66.6/時） |

### CPU でも動くのでは？

今回の検証で GPU メモリ使用量は **1.75 GB** でした。L4 の 24GB に対してわずか 7% しか使っていません。Fish Speech は CPU でも動作するため、GPU なしの VPS でも利用可能です（ただし推論速度は 10〜30 倍遅くなります）。

CPU 2GB プラン（¥1,144/月）の場合、損益分岐点は **月約 50 万文字** まで下がります。リアルタイム性が不要なバッチ処理であれば、CPU プランで十分かもしれません。

### 結論

**ほとんどのユースケースでは商用 API のほうが安い** です。

自前運用が有利になるのは以下のケースです。

- **大量バッチ生成**（月1,700万文字超）
- **音声クローニング**（商用 API では提供されていない、または制限が厳しい機能）
- **データの外部送信が不可**（オンプレ要件）
- **時間課金で短時間だけ使う**（¥66.6/時 × 数時間）

---

## Go CLI クライアント

今回のサンプルには、Fish Speech API を呼び出す Go 製の CLI クライアントも同梱しています。

```bash
cd fish-speech-tts-gpu/cli
go build -o fish-speech-cli .
```

```bash
# テキスト → WAV再生（oto v3によるネイティブ再生）
./fish-speech-cli tts -t "こんにちは、世界！" --server http://<IP>:8080

# ファイルに保存
./fish-speech-cli tts -t "Hello" -o hello.wav --server http://<IP>:8080

# 音声クローニング
./fish-speech-cli ref add --name my-voice --file voice.wav --text "音声のテキスト"
./fish-speech-cli tts -t "クローニングされた声" --ref my-voice

# ヘルスチェック
./fish-speech-cli health --server http://<IP>:8080
```

全サブコマンド: `tts`, `health`, `ref` (add/list/delete/update), `encode`, `decode`

※ CLI は REST API サーバー（ポート 8080）に接続する設計です。WebUI（ポート 7860）のみの構成では別途 API サーバーの起動が必要です。

---

## まとめ

- **Fish Speech 1.5** を ConoHa VPS3 の NVIDIA L4 GPU にデプロイし、日本語・韓国語・英語で自然な音声生成を確認しました
- GPU ドライバのセットアップ → `conoha app deploy` の流れで、ターミナルだけで完結します
- **S2 Pro モデル**（ベンチマーク1位、80+言語対応）は Docker イメージのトークナイザーバグ（[#1266](https://github.com/fishaudio/fish-speech/issues/1266)）のため現時点で利用不可。修正待ちです
- コスト面では、月 1,700 万文字を超える大量生成や音声クローニングでない限り、**商用 API のほうが安い**です
- GPU メモリ使用量が 1.75 GB と軽量なので、**CPU プランでも動作可能**（速度はトレードオフ）

サンプルコードは [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples/tree/main/fish-speech-tts-gpu) にあります。

---

### 参考

- [Fish Speech 公式サイト](https://speech.fish.audio/)
- [Fish Speech GitHub](https://github.com/fishaudio/fish-speech)
- [fishaudio/fish-speech#1266 - NoneType tokenizer bug](https://github.com/fishaudio/fish-speech/issues/1266)
- [ConoHa VPS3 GPU プラン](https://vps.conoha.jp/gpu/)
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
