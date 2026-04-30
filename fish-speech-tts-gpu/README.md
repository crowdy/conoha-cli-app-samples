# Fish Speech TTS (GPU)

NVIDIA L4 GPU を使用して、Fish Speech の音声合成（TTS）サーバーと WebUI をデプロイするサンプルです。Go で書かれた CLI クライアントを同梱しており、API 経由でテキスト音声変換とオーディオ再生が可能です。

## 構成

| サービス | ポート | 説明 |
|---------|--------|------|
| Fish Speech WebUI | 7860 | Gradio ベースの Web インターフェース |
| Fish Speech API | 8080 | REST API サーバー（CLI から利用） |

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) **v0.7.0 以上** (`conoha gpu setup` を使用)
- SSH キーが登録済み
- **GPU フレーバー**: `g2l-t-c20m128g1-l4`（NVIDIA L4 GPU）

## GPU セットアップ

### Step 1: サーバー作成

Docker プリインストール済みの `vmi-docker-29.2-ubuntu-24.04-amd64` をベースイメージに使うと、Docker 自体のインストールが省けます。

```bash
conoha server create \
  --name fish-speech \
  --flavor g2l-t-c20m128g1-l4 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name <あなたのキー名> \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --yes --wait
```

### Step 2: NVIDIA ドライバ + Container Toolkit (1 コマンド)

`conoha gpu setup` が以下を自動で行います: apt lock 待ち → Container Toolkit 導入 → ドライバ導入 (`ubuntu-drivers install --gpgpu`) → 再起動 → `nvidia-smi` 検証。

```bash
conoha gpu setup fish-speech
```

完了すると L4 GPU が認識されたログが表示されます。

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

### REST API

API サーバー（ポート 8080）は **conoha-proxy 経由では公開されません** — proxy は HTTP ホスト 1 つにつき 1 ポートしかルーティングできず、WebUI（7860）のみを外部公開しています。さらに `expose:` のみで host-side binding も無いため、SSH トンネル (`-L 8080:localhost:8080`) ではホスト側の 8080 に何もバインドされておらず到達できません。

API を叩くには VPS に SSH でログイン後、実行中の fish-speech コンテナ内から実行してください：

```bash
conoha server ssh fish-speech
# コンテナ内で curl:
docker exec $(docker ps --filter label=com.docker.compose.service=fish-speech --format '{{.Names}}') \
  curl -s http://localhost:8080/v1/health
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

CLI は `--server` で API ベース URL を受け取ります。blue/green proxy 構成では 8080 が外部ネットワークに露出しないため、**この構成ではローカル端末から直接 CLI を実行できません**。以下いずれかの方法を使用してください：

- **VPS 内で CLI を実行**: バイナリを VPS に転送し、同じ compose ネットワーク上のコンテナとして起動するか、`docker cp` で fish-speech コンテナに入れて `docker exec` で実行。CLI 内からは `--server http://localhost:8080` が到達可能。
- **API 用 FQDN を追加**: 別の `conoha.yml` プロジェクトで 8080 を proxy 経由で公開し、CLI から `--server https://api.<your FQDN>` で接続（2 つの FQDN が必要）。
- **開発/ローカル用途**: `compose.yml` で `expose:` を `ports: ["8080:8080"]` に戻す（blue/green 2 スロット共存時には衝突するため本番非推奨）。

以下はコンテナ内から CLI を実行する想定のコマンド例です：

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

## クリーンアップ

検証後に課金を止めるには、サーバーとブートボリュームをまとめて削除します。

```bash
conoha server delete fish-speech --delete-boot-volume --yes
```

`--delete-boot-volume` を付けないとブートボリュームが `available` 状態で残り続け、次回以降の `server create` がボリュームクォータで失敗するため注意してください。

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
