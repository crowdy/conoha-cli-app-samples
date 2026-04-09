# dokploy

[Dokploy](https://dokploy.com/) を ConoHa VPS3 上にインストールするサンプルです。Dokploy は Heroku / Vercel / Netlify のオープンソース代替となるセルフホスティング PaaS で、VPS 一台で自分だけのデプロイ基盤を構築できます。

## ⚠️ このサンプルの特殊性

> **このサンプルは他のサンプルと違い、`conoha app deploy` を使いません。**
>
> Dokploy 自体が PaaS コントローラであり、内部で Docker Swarm を必須としています。公式 `install.sh` が Swarm 初期化、overlay ネットワーク作成、Swarm secret の生成、4 つのサービス起動を一括で行うため、`docker compose up` だけで再現するのは現実的ではありません。
>
> このサンプルでは公式インストーラを ConoHa 向けに薄くラップした `install-on-conoha.sh` を提供します。

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| PaaS コントローラ | Dokploy | v0.28.8 (固定) |
| リバースプロキシ | Traefik | v3.6.x (Dokploy が同梱) |
| データベース | PostgreSQL | 16 (Dokploy が同梱) |
| キャッシュ・キュー | Redis | 7 (Dokploy が同梱) |
| コンテナランタイム | Docker + Docker Swarm | 28.x (install.sh が導入) |

## アーキテクチャ

```
                          ┌──────────────────┐
              :80/:443    │  Traefik (host)  │
              ───────────▶│  dokploy-traefik │
                          └────────┬─────────┘
                                   │ overlay
                                   │ "dokploy-network"
              :3000                │
              ───────────▶┌────────┴─────────┐
                          │  Dokploy (svc)   │
                          │     :3000        │
                          └─┬──────────────┬─┘
                            │              │
                  ┌─────────▼──┐   ┌───────▼──────┐
                  │ postgres   │   │   redis      │
                  │ (svc) :5432│   │ (svc) :6379  │
                  └────────────┘   └──────────────┘

  すべて 1 台の Docker Swarm マネージャノード上で動作する
```

- **dokploy-traefik**: ホストモードで :80 / :443 を公開する Traefik (`docker run`)
- **dokploy**: メインのコントロールプレーン。Web UI を :3000 で公開 (`docker service`)
- **dokploy-postgres**: Dokploy 自身のメタデータ用 (`docker service`)
- **dokploy-redis**: Dokploy 自身のキュー用 (`docker service`)

## ディレクトリ構成

```
dokploy/
├── README.md             # このファイル
└── install-on-conoha.sh  # ConoHa 向けインストーラ (公式 install.sh の薄いラッパー)
```

`compose.yml` はありません。理由は冒頭の「このサンプルの特殊性」を参照してください。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キー設定済み
- **`g2l-t-4` (4GB) 以上推奨** — Dokploy 本体 + 同梱 Postgres/Redis/Traefik + 最初のアプリのビルドで概ね 2-3 GB を使う
- ConoHa Ubuntu 24.04 イメージ (`ss` などの `iproute2` コマンドが標準で利用可能)

## デプロイ

### 1. サーバーを作成

```bash
conoha server create \
  --name dokploy-host \
  --flavor g2l-t-4 \
  --image ubuntu-24.04 \
  --key mykey
```

### 2. サーバー内で install-on-conoha.sh を実行

`conoha server ssh` で接続して、ラッパースクリプトを root で実行します:

```bash
conoha server ssh dokploy-host

# 接続後（サーバー内で実行）
curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh \
  | sudo bash
```

スクリプトは以下を行います:

1. root 権限と ports 80 / 443 / 3000 の空き状況を事前チェック
2. 環境変数 `DOKPLOY_VERSION` (デフォルト `v0.28.8`) と `DOCKER_SWARM_INIT_ARGS` を設定
3. 公式 `https://dokploy.com/install.sh` を呼び出す (Docker のインストール、Swarm init、4 サービス起動を全自動で実施)
4. 完了後にダッシュボード URL と次のステップを表示

### 代替: リポをクローンして実行

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/dokploy
sudo bash install-on-conoha.sh
```

### バージョンを変更したい場合

```bash
export DOKPLOY_VERSION=v0.28.8
curl -fsSL https://raw.githubusercontent.com/.../install-on-conoha.sh | sudo -E bash
```

## 動作確認

1. ブラウザで `http://<サーバーIP>:3000` にアクセス
2. 初回アクセス時に表示される画面で初期管理者アカウント (Email + Password) を作成
3. ダッシュボードが表示されれば成功

## 🎯 はじめてのアプリデプロイ — hello-world ウォークスルー

このリポジトリの `hello-world` サンプルを Dokploy 経由でデプロイしてみます。これで「VPS 一台 + Dokploy = 自分だけの PaaS」のストーリーが完結します。

### 1. プロジェクトを作成

ダッシュボード上で **Create Project** → 名前を `demo` として作成します。

### 2. アプリケーションを追加

`demo` プロジェクトを開き、**Create Application** をクリックします。アプリケーション名は任意 (例: `hello-world`)。

### 3. ソースを設定

作成したアプリの設定画面で **Provider: Public Git** を選び、以下を入力します:

| 項目 | 値 |
|------|-----|
| Repository URL | `https://github.com/crowdy/conoha-cli-app-samples` |
| Branch | `main` |
| Build Path | `hello-world` |
| Build Type | `Dockerfile` |

> **モノレポのサブディレクトリ指定** が現バージョンの Dokploy で動かない場合は、リポをフォークして `hello-world/` だけを残したリポを Repository URL に指定してください。

### 4. ドメインを設定

**Domains** タブを開き、**Add Domain** をクリック。Dokploy が自動生成する `*.traefik.me` のホスト名 (例: `<random>.traefik.me`) を採用すると、外部 DNS なしでアクセスできます。

> `*.traefik.me` が解決しない場合は、サーバーの IP アドレスをホスト名にして、Dokploy が割り当てた内部ポートで直接アクセスする方法もあります。`Show Logs` で割り当てポートを確認できます。

### 5. デプロイ

**Deploy** ボタンをクリック。ビルドログがリアルタイムに流れ、`hello-world` の Dockerfile (nginx + 静的 HTML) がビルドされます。完了したらドメインをブラウザで開き、`Hello World` ページが表示されれば成功です。

### 6. 振り返り

ここまでで以下が動いています:

- ConoHa VPS 1 台
- その上で Dokploy 本体 + Traefik + 自動 HTTPS 基盤 + メタデータ DB
- さらにその上で `hello-world` アプリが Dokploy 経由でビルド・デプロイされ、Traefik 経由で公開

このリポジトリの他のサンプル (例: `vite-react`, `hono-drizzle-postgresql`) も同じ手順でデプロイできます。Build Path だけ変えてください。

## 💡 Tip: テンプレートマーケットプレース

Dokploy には Pocketbase / Plausible / Cal.com など人気の OSS をワンクリックでデプロイできるテンプレートが組み込まれています。**Templates** メニューから試してみてください。

## 本番運用のヒント

- **独自ドメイン + 自動 HTTPS**: ドメイン DNS の A レコードをサーバー IP に向けたうえで、Dokploy の Domain 設定で **HTTPS** と **Certificate Provider: Let's Encrypt** を選ぶだけで Traefik が自動取得・更新します
- **バックアップ**: Dokploy の **Settings** から `dokploy-postgres` ボリュームの定期バックアップを設定できます
- **バージョン固定**: `install-on-conoha.sh` の `DEFAULT_DOKPLOY_VERSION` を編集するか、環境変数 `DOKPLOY_VERSION` で明示的に固定してください。`latest` や `canary` は再現性を損ねるため非推奨です
- **アップグレード**: 既存ホストでは `curl -fsSL https://dokploy.com/install.sh | bash -s update` でメジャーバージョンを上げられます

## アンインストール

完全に元に戻したい場合は以下を順に実行します:

```bash
# Dokploy のサービスを削除
docker service rm dokploy dokploy-postgres dokploy-redis

# Traefik コンテナを削除
docker rm -f dokploy-traefik

# Swarm secret を削除
docker secret rm dokploy_postgres_password

# Overlay ネットワークを削除
docker network rm dokploy-network

# データボリュームを削除（永続データも消えます）
docker volume rm dokploy dokploy-postgres dokploy-redis

# Swarm モードを抜ける
docker swarm leave --force

# Dokploy の設定ディレクトリを削除
sudo rm -rf /etc/dokploy
```

## トラブルシューティング

### ポート競合で install-on-conoha.sh が落ちる

`install-on-conoha.sh` は :80 / :443 / :3000 のいずれかが既に使われていると即座に終了します。`ss -tulnp` で何が使っているか確認し、`systemctl stop` 等で止めてから再実行してください。

### Swarm overlay の CIDR が他のネットワークと衝突する

デフォルトでは `10.20.0.0/16` を Swarm overlay 用に確保しています。もしそれが既存のネットワーク (社内 VPN など) と衝突する場合は、環境変数で別の範囲を指定してください:

```bash
export DOCKER_SWARM_INIT_ARGS="--default-addr-pool 172.30.0.0/16 --default-addr-pool-mask-length 24"
sudo -E bash install-on-conoha.sh
```

### `/etc/dokploy` の権限が `chmod 777` なのは何故？

公式 `install.sh` がそのように作成します。Dokploy 本体および Traefik コンテナがそれぞれ非 root ユーザでこのディレクトリを読み書きするためです。本番運用時に懸念がある場合は、Dokploy のドキュメントを参照して所有者・モードを調整してください。

### 動作確認チェックリスト

- [ ] `conoha server create --flavor g2l-t-4 ...` が成功する
- [ ] `install-on-conoha.sh` がエラーなく完走する
- [ ] `http://<IP>:3000` で Dokploy のダッシュボードが見える
- [ ] 初期管理者アカウントを作成できる
- [ ] hello-world ウォークスルーで `Hello World` ページが表示される
- [ ] アンインストール手順で完全に元に戻る (`docker info | grep Swarm` が `inactive`)

## 関連リンク

- [Dokploy 公式サイト](https://dokploy.com/)
- [Dokploy ドキュメント](https://docs.dokploy.com/)
- [Dokploy GitHub](https://github.com/dokploy/dokploy)
- [conoha-cli](https://github.com/crowdy/conoha-cli)
