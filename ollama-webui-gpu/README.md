# ollama-webui-gpu

NVIDIA GPU フレーバーで Ollama と Open WebUI を使ったローカル LLM チャット環境です。GPU を活用することで Gemma 4 などの大規模モデルが快適に動作します。

## 構成

- Ollama（LLM サーバー・GPU 対応）
- Open WebUI（チャット UI）
- ポート: 3000

## 対応モデル（例）

| モデル | サイズ | 必要 VRAM |
|--------|------|----------|
| gemma4:31b | 20GB | 22GB+ |
| gemma4:26b | 18GB | 20GB+ |
| gemma4:e4b | 9.6GB | 12GB+ |
| gemma3:27b | 17GB | 20GB+ |

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- **L4 GPU フレーバー**のサーバー（`g2l-*-l4` シリーズ）
- サーバーに NVIDIA ドライバーと Container Toolkit がインストール済み

## GPU 環境のセットアップ

初回のみ、以下のスクリプトをサーバーにデプロイして GPU 環境を構築します。

```bash
# 1. NVIDIA Container Toolkit のインストール
cat > nvidia-setup.sh << 'EOF'
#!/bin/bash
set -e
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update -q
apt-get install -y nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker
EOF

# 2. NVIDIA ドライバーのインストール
cat > nvidia-driver-setup.sh << 'EOF'
#!/bin/bash
set -e
apt-get install -y ubuntu-drivers-common
ubuntu-drivers install --gpgpu
EOF

# 3. nvidia-smi ユーティリティのインストール
cat > nvidia-utils-setup.sh << 'EOF'
#!/bin/bash
set -e
apt-get install -y nvidia-utils-570-server
systemctl restart docker
nvidia-smi
EOF

conoha server deploy <サーバー名> --script nvidia-setup.sh --identity ~/.ssh/conoha_<キー名>
conoha server deploy <サーバー名> --script nvidia-driver-setup.sh --identity ~/.ssh/conoha_<キー名>

# ドライバーインストール後は再起動が必要
conoha server reboot <サーバー名> --wait --no-input --yes

conoha server deploy <サーバー名> --script nvidia-utils-setup.sh --identity ~/.ssh/conoha_<キー名>
```

## デプロイ

```bash
# 1. conoha.yml の `hosts:` を自分の FQDN に書き換える
#    DNS A レコードがサーバー IP を指している必要があります

# 2. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com <サーバー名> \
  --identity ~/.ssh/conoha_<キー名>

# 3. アプリ登録
conoha app init <サーバー名> \
  --identity ~/.ssh/conoha_<キー名> --no-input

# 4. デプロイ（初回は gemma4:31b の pull で数分かかります）
conoha app deploy <サーバー名> \
  --identity ~/.ssh/conoha_<キー名> --no-input
```

`ollama` は accessory として宣言されているため、GPU-resident モデルは blue/green 切替越しに維持されます — webui のコード変更で再デプロイしても 20GB のモデルを pull し直す必要はありません。

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスするとチャット画面が表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

`compose.yml` の `ollama pull gemma4:31b` を変更することで別のモデルを使用できます。

```yaml
entrypoint: ["/bin/sh", "-c", "ollama serve & sleep 10 && ollama pull gemma4:26b && wait"]
```

認証を有効にする場合は `WEBUI_AUTH=true` に変更してください。

## CPU 版との違い

GPU なしの軽量版は [ollama-webui](../ollama-webui/) を参照してください。
