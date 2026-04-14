# Fish Speech TTS GPU サンプル設計書

## 概要

ConoHa VPS3 の NVIDIA L4 GPU フレーバーを使用して、Fish Speech（TTS + 音声クローニング）の WebUI と API サーバーをデプロイするサンプル。Go で書かれた CLI クライアントを同梱し、API 経由でのテキスト音声変換とオーディオ再生を提供する。

## アーキテクチャ

### アプローチ

公式 Docker イメージ `fishaudio/fish-speech:latest-webui-cuda` をそのまま使用し、entrypoint ラッパースクリプトでモデルの自動ダウンロードを処理する。`ollama-webui-gpu` サンプルのパターンを踏襲。

### ディレクトリ構造

```
fish-speech-tts-gpu/
├── compose.yml
├── entrypoint.sh
├── cli/
│   ├── main.go
│   ├── cmd/
│   │   ├── tts.go
│   │   ├── encode.go
│   │   ├── decode.go
│   │   ├── ref.go
│   │   └── health.go
│   ├── client/
│   │   └── client.go
│   ├── audio/
│   │   └── player.go
│   ├── go.mod
│   ├── go.sum
│   └── Makefile
├── README.md
└── .dockerignore
```

## Docker 構成

### compose.yml

```yaml
services:
  fish-speech:
    image: fishaudio/fish-speech:latest-webui-cuda
    entrypoint: ["/bin/bash", "/app/custom-entrypoint.sh"]
    ports:
      - "7860:7860"   # WebUI
      - "8080:8080"   # API server
    volumes:
      - ./entrypoint.sh:/app/custom-entrypoint.sh:ro
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
      - COMPILE=1
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 20
      start_period: 600s

volumes:
  model_data:
  references:
```

### entrypoint.sh

- `huggingface-cli download fishaudio/s2-pro --local-dir /app/checkpoints/s2-pro` を実行（チェックポイントが存在しない場合のみ）
- ダウンロード完了後、元のサーバープロセスを起動

## Go CLI 設計

### モジュール情報

- **モジュール名**: `github.com/example/fish-speech-cli`
- **Go バージョン**: 1.23+
- **CLI フレームワーク**: `github.com/spf13/cobra`
- **オーディオ再生**: `github.com/ebitengine/oto/v3`

### サブコマンド

```
fish-speech-cli <command> [flags]

Commands:
  tts          テキストを音声に変換
  encode       オーディオ → VQ トークン変換
  decode       VQ トークン → オーディオ変換
  ref add      リファレンス音声を追加
  ref list     リファレンス音声の一覧
  ref delete   リファレンス音声を削除
  ref update   リファレンス音声を更新
  health       サーバーヘルスチェック
```

### tts コマンドフラグ

| フラグ | デフォルト | 説明 |
|--------|-----------|------|
| `--server` | `http://localhost:8080` | API サーバーアドレス |
| `--text` / `-t` | (必須) | 変換するテキスト |
| `--output` / `-o` | (なければ再生) | 出力ファイルパス |
| `--format` | `wav` | 出力フォーマット (wav/mp3/opus) |
| `--ref` | (なし) | リファレンス音声名 |
| `--play` | `true` | 再生するかどうか (--output 指定時は自動 false) |

### 使用例

```bash
# テキスト → スピーカー再生
fish-speech-cli tts -t "こんにちは"

# ファイルに保存
fish-speech-cli tts -t "Hello" -o hello.wav

# 音声クローニング
fish-speech-cli tts -t "안녕하세요" --ref my-voice

# リファレンス管理
fish-speech-cli ref add --name my-voice --file voice.wav
fish-speech-cli ref list
fish-speech-cli ref delete --name my-voice

# ヘルスチェック
fish-speech-cli health --server http://192.168.1.100:8080
```

### パッケージ構造

#### client/client.go

Fish Speech API への HTTP クライアント。全エンドポイントをカバー。

```go
type Client struct {
    BaseURL    string
    HTTPClient *http.Client
}

func (c *Client) TTS(req TTSRequest) ([]byte, error)           // POST /v1/tts
func (c *Client) Encode(audio io.Reader) ([]byte, error)       // POST /v1/vqgan/encode
func (c *Client) Decode(tokens []byte) ([]byte, error)         // POST /v1/vqgan/decode
func (c *Client) AddRef(name string, audio io.Reader) error    // POST /v1/references/add
func (c *Client) ListRefs() ([]Reference, error)               // GET /v1/references/list
func (c *Client) DeleteRef(name string) error                  // DELETE /v1/references/delete
func (c *Client) UpdateRef(old, new string) error              // POST /v1/references/update
func (c *Client) Health() error                                // GET /v1/health
```

#### audio/player.go

WAV ヘッダーをパースしてサンプルレート・ビット深度・チャンネル数を抽出。`oto.NewContext()` → `context.NewPlayer()` で PCM データをストリーミング再生。

- `--output` 未指定 → 自動再生
- `--output` 指定 → ファイル保存

## GPU セットアップとデプロイフロー

### デプロイ手順

```
1. conoha server add --flavor g2l-*-l4 --image ubuntu-24.04 --key mykey --name fish-speech
2. conoha server ssh fish-speech
   → NVIDIA Container Toolkit インストール
   → NVIDIA ドライバインストール
3. conoha server reboot fish-speech
4. conoha server ssh fish-speech
   → nvidia-utils-570-server インストール + nvidia-smi 確認
5. conoha app deploy fish-speech --app fish-speech-tts-gpu
   → compose up → entrypoint.sh → モデル自動ダウンロード → サーバー起動
6. ブラウザ: http://<IP>:7860 (WebUI)
   CLI: fish-speech-cli --server http://<IP>:8080 tts -t "テスト"
```

### GPU セットアップコマンド

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

# Step 3: Reboot → nvidia-utils
sudo apt install -y nvidia-utils-570-server
nvidia-smi
```

### ヘルスチェック戦略

- Fish Speech API の `/v1/health` エンドポイントを使用
- `start_period: 600s` — モデルダウンロード時間を考慮（s2-pro 数 GB）
- 20 retries で十分な余裕を確保

## 依存関係まとめ

### Docker

| コンポーネント | イメージ / ツール |
|---------------|------------------|
| Fish Speech | `fishaudio/fish-speech:latest-webui-cuda` |
| モデル | `fishaudio/s2-pro` (HuggingFace, 自動ダウンロード) |
| GPU ランタイム | NVIDIA Container Toolkit + ドライバ |

### Go CLI

| パッケージ | 用途 |
|-----------|------|
| `github.com/spf13/cobra` | CLI フレームワーク |
| `github.com/ebitengine/oto/v3` | オーディオ再生 |
| 標準ライブラリ (`net/http`, `encoding/json`, `io`, `os`) | API 呼び出し、ファイル I/O |

## README 構成

日本語で、既存サンプル（`ollama-webui-gpu`）と同じ形式：

1. タイトル + 簡潔な説明
2. 構成（サービス一覧 + ポート）
3. 前提条件（conoha-cli、SSH キー、GPU フレーバー）
4. GPU セットアップ手順
5. デプロイ手順
6. 動作確認（WebUI + CLI）
7. Go CLI の使い方（ビルド方法 + コマンド例）
8. カスタマイズ（モデル変更、API キー設定など）
9. 関連リンク
