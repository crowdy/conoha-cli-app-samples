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

### Step 1: サーバー作成

```bash
conoha server add --flavor g2l-t-c20m128g1-l4 --image ubuntu-24.04 --key mykey --name hunyuan3d
```

### Step 2: NVIDIA Container Toolkit

```bash
conoha server ssh hunyuan3d
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

### Step 3: NVIDIA ドライバ

```bash
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu
```

### Step 4: 再起動

```bash
exit
conoha server reboot hunyuan3d
```

### Step 5: ドライバ確認

```bash
conoha server ssh hunyuan3d
sudo apt install -y nvidia-utils-570-server
nvidia-smi
```

## デプロイ

```bash
conoha app deploy hunyuan3d --app hunyuan3d-gpu
```

初回起動は **15〜20 分** かかります (Docker build ~10 分 + モデル DL ~10 分)。`docker compose ps` の healthcheck が `healthy` になるまで待ってください。2 回目以降はモデルがキャッシュされているため即起動します。

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
