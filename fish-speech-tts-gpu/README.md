# Fish Speech TTS (GPU)

NVIDIA L4 GPU を使用して、Fish Speech の音声合成（TTS）サーバーと WebUI をデプロイするサンプルです。Go で書かれた CLI クライアントを同梱しており、API 経由でテキスト音声変換とオーディオ再生が可能です。

## 構成

| サービス | ポート | 説明 |
|---------|--------|------|
| Fish Speech WebUI | 7860 | Gradio ベースの Web インターフェース |
| Fish Speech API | 8080 | REST API サーバー（CLI から利用） |

## 前提条件

- [conoha-cli](https://github.com/because-and/conoha-cli) がインストール済み
- SSH キーが登録済み
- **GPU フレーバー**: `g2l-t-c20m128g1-l4`（NVIDIA L4 GPU）

## GPU セットアップ

サーバー作成後、GPU ドライバのインストールが必要です。

### Step 1: サーバー作成

```bash
conoha server add --flavor g2l-t-c20m128g1-l4 --image ubuntu-24.04 --key mykey --name fish-speech
```

### Step 2: NVIDIA Container Toolkit インストール

```bash
conoha server ssh fish-speech
```

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Step 3: NVIDIA ドライバインストール

```bash
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu
```

### Step 4: サーバー再起動

```bash
exit
conoha server reboot fish-speech
```

### Step 5: ドライバ確認

```bash
conoha server ssh fish-speech
sudo apt install -y nvidia-utils-570-server
nvidia-smi
```

GPU が認識されていることを確認してください。

## デプロイ

```bash
# 1. conoha.yml の `hosts:` を自分の FQDN に書き換える
#    (DNS A レコードがサーバー IP を指している必要があります)

# 2. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com fish-speech

# 3. アプリ登録
conoha app init fish-speech

# 4. デプロイ
conoha app deploy fish-speech
```

初回起動時は Fish Speech モデル（s2-pro）の自動ダウンロードが行われるため、数分かかります。2 回目以降はモデルがキャッシュされているため即座に起動します。

## 動作確認

### WebUI

ブラウザで `https://<あなたの FQDN>` にアクセスしてください。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

### REST API（コンテナ内 / SSH トンネル経由）

API サーバー（ポート 8080）は **conoha-proxy 経由では公開されません**。proxy は HTTP ホスト 1 つにつき 1 ポートしかルーティングできないため、WebUI（7860）のみが外部から到達可能です。API を呼ぶには次のいずれかの方法を使用してください。

- **SSH トンネル**（手元のマシンから API を叩く場合）:

  ```bash
  ssh -L 8080:localhost:8080 root@<サーバー IP>
  # 別ターミナルから:
  curl http://localhost:8080/v1/health
  curl -X POST http://localhost:8080/v1/tts \
    -H "Content-Type: application/json" \
    -d '{"text":"こんにちは、世界！","format":"wav"}' \
    -o hello.wav
  ```

- **VPS 内で直接実行**（SSH ログイン後）:

  ```bash
  curl http://localhost:8080/v1/health
  ```

## Go CLI クライアント

### ビルド

```bash
cd cli
make build
```

Go 1.23 以上が必要です。Linux では ALSA 開発ライブラリも必要です：

```bash
# Ubuntu/Debian
sudo apt install libasound2-dev
```

### 使い方

CLI は `--server` で API ベース URL を受け取ります。proxy 経由では API が公開されないため、SSH トンネル (`ssh -L 8080:localhost:8080 root@<サーバー IP>`) を張ったローカル端末から `--server http://localhost:8080` で接続するか、VPS 内に CLI バイナリを配置してそこから実行してください。

```bash
# テキスト → スピーカー再生
./fish-speech-cli tts -t "こんにちは" --server http://localhost:8080

# ファイルに保存
./fish-speech-cli tts -t "Hello, world!" -o hello.wav --server http://localhost:8080

# 音声クローニング（リファレンス音声を使用）
./fish-speech-cli ref add --name my-voice --file voice.wav --text "音声のテキスト" --server http://localhost:8080
./fish-speech-cli tts -t "クローニングされた声" --ref my-voice --server http://localhost:8080

# リファレンス音声の管理
./fish-speech-cli ref list --server http://localhost:8080
./fish-speech-cli ref delete --name my-voice --server http://localhost:8080

# オーディオ → VQ トークン変換
./fish-speech-cli encode --input audio.wav --output tokens.json --server http://localhost:8080
./fish-speech-cli decode --input tokens.json --output output.wav --server http://localhost:8080

# ヘルスチェック
./fish-speech-cli health --server http://localhost:8080
```

## カスタマイズ

### モデルの変更

`entrypoint.sh` のモデルパスを変更してください：

```bash
# s2-pro の代わりに openaudio-s1-mini を使用
MODEL_DIR="/app/checkpoints/openaudio-s1-mini"
```

`compose.yml` の `COMPILE` 環境変数で `torch.compile` 最適化を無効にできます：

```yaml
environment:
  - COMPILE=0
```

### API キーの設定

API サーバーに認証を追加するには、`entrypoint.sh` の API サーバー起動コマンドに `--api-key` フラグを追加してください。

## 関連リンク

- [Fish Speech](https://speech.fish.audio/) - 公式サイト
- [Fish Speech GitHub](https://github.com/fishaudio/fish-speech) - ソースコード
- [ConoHa VPS3](https://www.conoha.jp/vps/) - GPU フレーバー
