# Hunyuan3D 2 (GPU)

NVIDIA L4 GPU を使用して、Tencent Hunyuan3D-2 で画像から 3D モデル (GLB) を生成するサンプルです。Gradio WebUI で 1 枚の画像をアップロードするだけで shape (+ optional texture) を生成・ダウンロードできます。

## 構成

| サービス | ポート | 説明 |
|---------|--------|------|
| Hunyuan3D Gradio WebUI | 7860 | 画像→3D 生成 UI |

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) **v0.7.0 以上** (`conoha gpu setup` を使用)
- SSH キーが登録済み
- **GPU フレーバー**: `g2l-t-c20m128g1-l4` (NVIDIA L4 24GB)

## GPU セットアップ

### Step 1: サーバー作成

Docker プリインストール済みの `vmi-docker-29.2-ubuntu-24.04-amd64` をベースイメージに使うと、Docker 自体のインストールが省けます。

```bash
conoha server create \
  --name hunyuan3d \
  --flavor g2l-t-c20m128g1-l4 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name <あなたのキー名> \
  --security-group IPv4v6-SSH \
  --security-group 3000-9999 \
  --yes --wait
```

### Step 2: NVIDIA ドライバ + Container Toolkit (1 コマンド)

`conoha gpu setup` が以下を自動で行います: apt lock 待ち → Container Toolkit 導入 → ドライバ導入 (`ubuntu-drivers install --gpgpu`) → 再起動 → `nvidia-smi` 検証。

```bash
conoha gpu setup hunyuan3d
```

完了すると以下のような L4 認識ログが出ます。

```
NVIDIA-SMI 595.58.03    Driver Version: 595.58.03    CUDA Version: 13.2
0  NVIDIA L4    23034MiB
```

## デプロイ

```bash
conoha app deploy hunyuan3d --app-name hunyuan3d-gpu
```

初回起動は **15〜20 分** かかります (Docker build ~10 分 + モデル DL ~10 分)。`docker compose ps` の healthcheck が `healthy` になるまで待ってください。2 回目以降はモデルがキャッシュされているため即起動します。

サーバーで `conoha proxy boot` を済ませている場合は blue/green モードで `conoha.yml` 経由のデプロイになりますが、本サンプルは `conoha.yml` を含めていないため flat single-slot モード (`--no-proxy` 相当) で動作します。

## 動作確認

ブラウザで `http://<サーバーIP>:7860` にアクセス。`assets/example_images/004.png` のような被写体中央のサンプル画像をアップロードし、shape only モードで生成→GLB ダウンロード。生成時間目安は shape のみ 30〜60 秒、shape + texture 60〜120 秒。

ダウンロードした GLB を Blender や https://gltf-viewer.donmccurdy.com/ で開いて確認できます。

## 既知の制限

- 入力画像は背景単色 / 透過 PNG、被写体中央が推奨。透明素材・極端なポーズは苦手
- 24GB L4 でも条件次第で texture 生成時に OOM の可能性。OOM 時は texture を切って shape only モードに
- シリアル処理 (同時利用キュー無し)
- HTTPS 無し / 認証無し (本サンプルはスモーク用途)

## クリーンアップ

検証後に課金を止めるには、サーバーとブートボリュームをまとめて削除します。

```bash
conoha server delete hunyuan3d --delete-boot-volume --yes
```

`--delete-boot-volume` を付けないとブートボリュームが `available` 状態で残り続け、次回以降の `server create` がボリュームクォータで失敗するため注意してください。

## ライセンス

Hunyuan3D-2 は **Tencent Hunyuan Community License**:

- 商用利用可 (月間アクティブユーザー 1 億未満の場合)
- 出力物の商用利用可

公式: https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE
