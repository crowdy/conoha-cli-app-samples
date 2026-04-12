---
title: conoha-cli で Dokploy（OSSのVercel代替）を ConoHa VPS にインストール — `app deploy` を使わない唯一のサンプルと、Claude Code に丸投げする方法
tags: Conoha conoha-cli Dokploy Docker ClaudeCode
author: crowdy
slide: false
---
## はじめに

[Dokploy](https://dokploy.com/) は Heroku / Vercel / Netlify のオープンソース代替を謳うセルフホスティング PaaS です。VPS 1台で「自分だけのデプロイ基盤」を構築できます。

これまでこのシリーズでは、[WordPress](https://qiita.com/crowdy/items/94d176b9e5aea2f451ab)、[Next.js](https://qiita.com/crowdy/items/2f764587145345fe7a07)、[Strapi](https://qiita.com/crowdy/items/ee2f911a3798078cc62b)、[Quickwit + OpenTelemetry](https://qiita.com/crowdy/items/5f8927cb69c1f2c2ab55) などのサンプルを `conoha app deploy` ワンコマンドでデプロイする方法を紹介してきました。

しかし今回の Dokploy サンプルは、シリーズの中で **唯一 `conoha app deploy` を使わない** 異色の存在です。本記事ではその理由と、代わりに `conoha server ssh` を使う構成、さらに **Claude Code + conoha skill にまるごと丸投げする方法** を紹介します。

---

## なぜ `conoha app deploy` を使わないのか

理由は単純で、**Dokploy 自身が PaaS コントローラだから** です。

`conoha app deploy` は「`compose.yml` のあるディレクトリを VPS に転送して `docker compose up -d --build` を叩く」という、Docker Compose 前提のシンプルなデプロイフローです。WordPress や Next.js のように **アプリが Docker Compose で完結する** 場合は、これだけで全部済みます。

ところが Dokploy は違います。Dokploy はインストール時に以下を一括でセットアップする必要があります。

- Docker のインストール
- **Docker Swarm の初期化**（`docker swarm init`）
- **Swarm overlay ネットワークの作成**（`dokploy-network`）
- **Swarm secret の生成**（`dokploy_postgres_password`）
- **3つの Swarm service の起動**（`dokploy`, `dokploy-postgres`, `dokploy-redis`）
- **Traefik コンテナのホストモード起動**（`docker run`）

これは `docker compose up` ではどうしても再現できません。`docker compose` は単一ホストの compose プロジェクト管理ツールであり、Swarm モード (`docker service`) や Swarm secret はそもそもスコープ外だからです。

公式の `https://dokploy.com/install.sh` がこれら全部を 1 本のスクリプトで自動実行するため、**Dokploy のインストールは「インストーラを root で叩く」のが正解** であって、「compose ファイルを撒く」モデルとは噛み合いません。

そのため、このサンプルは `compose.yml` を持っていません。代わりに公式 `install.sh` を ConoHa 向けに薄くラップした `install-on-conoha.sh` という 1 ファイルだけを置いています。

---

## 代わりに使うのは `conoha server ssh`

`app deploy` が使えないなら何で繋ぐかというと、`conoha server ssh` です。これはサーバー作成時に登録した SSH キーをそのまま使って VPS にログインするだけのシンプルなサブコマンドで、`~/.ssh/config` をいじらなくても `conoha server ssh <name>` で繋がります。

つまり、このサンプルのデプロイフローはこうなります。

```
[ローカル PC]
    │
    │ 1. conoha server create (CLI)
    ▼
[ConoHa VPS3]
    │
    │ 2. conoha server ssh で接続
    ▼
[サーバー内 shell]
    │
    │ 3. curl -fsSL .../install-on-conoha.sh | sudo -E bash
    ▼
[Dokploy 起動完了]
```

ローカルから `compose.yml` を転送するフェーズがありません。サーバー上で公式インストーラに身を委ねるだけです。

---

## `install-on-conoha.sh` が解決する 3 つの問題

公式 `install.sh` をそのまま叩いてもいいのに、なぜわざわざラッパーを置いているのか？理由は 3 つあります。

### 1. ConoHa VPS3 の「private IP がない」問題

Dokploy 公式 `install.sh` の内部実装は、`get_private_ip()` 関数で **RFC1918 の私設アドレス**（`10.x` / `172.16-31.x` / `192.168.x`）を探し、見つけたものを `--advertise-addr` として `docker swarm init` に渡します。

ところが ConoHa VPS3 のデフォルト構成では、**ホストには public IPv4 しか付いていません**。すると `get_private_ip()` が空文字列を返し、Swarm 初期化が始まる前に install.sh がエラーで止まります。

`install-on-conoha.sh` はホストに RFC1918 アドレスがないことを検出すると、`https://ifconfig.io` などを使って public IPv4 を取得し、`ADVERTISE_ADDR` 環境変数に詰めて公式インストーラに渡します。これで詰まらず通ります。

```bash
# install-on-conoha.sh より抜粋
ensure_advertise_addr() {
    if [ -n "${ADVERTISE_ADDR:-}" ]; then
        return  # 環境変数で明示指定されていればそれを使う
    fi

    if ip addr show | grep -qE "inet (192\.168\.|10\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.)"; then
        return  # 私設 IP があれば公式の検出に任せる
    fi

    # public IP を 3 つのサービスから順に試して取得
    for url in https://ifconfig.io https://icanhazip.com https://ipecho.net/plain; do
        public_ip="$(curl -4fsS --connect-timeout 5 "$url" | tr -d '[:space:]')"
        [ -n "$public_ip" ] && break
    done

    export ADVERTISE_ADDR="$public_ip"
}
```

### 2. バージョン固定（再現性）

公式 `install.sh` は環境変数 `DOKPLOY_VERSION` を見るので、`install-on-conoha.sh` ではこれをデフォルトで `v0.28.8` に固定しています。`latest` や `canary` のままだと「先週は動いたのに今日は動かない」が起きるので、サンプル目的では明確に固定しておきたい派です。

```bash
DEFAULT_DOKPLOY_VERSION="v0.28.8"
DOKPLOY_VERSION="${DOKPLOY_VERSION:-$DEFAULT_DOKPLOY_VERSION}"
```

もちろん上書きしたい人は `DOKPLOY_VERSION=v0.29.0 sudo -E bash install-on-conoha.sh` のように渡せばそちらが優先されます。

### 3. Swarm overlay の CIDR を `10.20.0.0/16` に寄せておく

Docker Swarm のデフォルト overlay は `10.0.0.0/8` から取られるため、ConoHa の private network と将来衝突する可能性があります。`install-on-conoha.sh` は `--default-addr-pool 10.20.0.0/16 --default-addr-pool-mask-length 24` を Swarm 初期化に渡して、領域を予め `10.20.x.x` に寄せます。

---

## 手動デプロイ手順

CLI を直接叩く場合は 3 ステップです。

### 1. サーバーを作成

```bash
conoha server create \
  --name dokploy-host \
  --flavor g2l-t-4 \
  --image ubuntu-24.04 \
  --key mykey
```

`g2l-t-4`（4GB RAM）を推奨しています。Dokploy 本体 + 同梱 Postgres/Redis/Traefik + 最初のアプリのビルドで概ね 2〜3 GB を使うため、2GB だと OOM に怯えながら運用することになります。

### 2. SSH で接続

```bash
conoha server ssh dokploy-host
```

`~/.ssh/config` を一切触らなくても、サーバー作成時に登録した鍵で繋がります。

### 3. ラッパースクリプトを実行

```bash
curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh \
  | sudo -E bash
```

ポイントは **`sudo -E`**。`-E` がないと sudo が `DOKPLOY_VERSION` や `ADVERTISE_ADDR` といった環境変数を剥がしてしまい、せっかく export しても無視されます。Dokploy の更新時にもハマるポイントなので、運用上は常に `-E` 付きで打つクセをつけておくのが安全です。

完了するとブラウザで `http://<サーバーIP>:3000` にアクセスでき、初回画面で管理者アカウント（Email + Password）を作るとダッシュボードに入れます。

---

## さらに簡単: Claude Code + conoha skill にまるごと丸投げする

ここまで「3 ステップで済む」と書きましたが、それすら面倒という人のために、もうひとつの選択肢があります。

[conoha-cli](https://github.com/crowdy/conoha-cli) には Claude Code 用の **conoha skill** が同梱されており、Claude Code から自然言語でインフラ操作ができます。Dokploy のインストールも、要するに以下の 1 行を Claude Code に投げるだけで終わります。

> ConoHa に Dokploy をインストールして。サーバー名は dokploy-host で、4GB プランで。

Claude Code は内部でこんな手順を組み立てて実行してくれます。

1. `conoha server create --name dokploy-host --flavor g2l-t-4 --image ubuntu-24.04 --key <既定鍵>`
2. サーバーが ACTIVE になるまで待機
3. `conoha server ssh dokploy-host` で接続
4. サーバー上で `curl ... install-on-conoha.sh | sudo -E bash` を実行
5. 起動を確認して、ダッシュボード URL（`http://<IP>:3000`）を返す

「VPS を立てる → ssh で繋ぐ → スクリプトを叩く」という人間の手作業を、CLI と SSH の組み合わせとして Claude Code が代行する形です。コマンドを覚えていなくても、フレーバー名の正確なスペルが分からなくても、**「Dokploy を入れて」と日本語で頼めば終わる** のがこの構成の最大のメリットです。

ここが他のサンプルと根本的に違うところで、`conoha app deploy` 系のサンプルだと「ローカルにリポジトリをクローンしてからデプロイする」フローが必要ですが、Dokploy 系は **ローカルに何もなくて、対話だけで完結します**。

---

## 動作確認

手動でも Claude Code 経由でも、完了後に以下を確認します。

1. ブラウザで `http://<サーバーIP>:3000` にアクセス
2. 初回表示される画面で初期管理者アカウント（Email + Password）を作成
3. ダッシュボードが表示されれば成功

---

## 最初のアプリを Dokploy 経由でデプロイしてみる

Dokploy が立ち上がっただけだと「セルフホスト PaaS を建てた」だけで終わってしまうので、せっかくなので同じリポジトリの `hello-world` サンプルを Dokploy ダッシュボードからデプロイしてみます。

1. **Create Project** で `demo` プロジェクトを作成
2. プロジェクト内で **Create Application** → 名前は任意（例: `hello-world`）
3. **Provider: Public Git** を選び、以下を入力

| 項目 | 値 |
|------|---|
| Repository URL | `https://github.com/crowdy/conoha-cli-app-samples` |
| Branch | `main` |
| Build Path | `hello-world` |
| Build Type | `Dockerfile` |

4. **Domains** タブで **Add Domain** → `*.traefik.me` のホスト名を採用すると外部 DNS 設定なしでアクセス可能
5. **Deploy** ボタンを押して、ビルドログがリアルタイムに流れるのを眺める
6. 完了後、自動生成された URL を開いて「Hello World」ページが表示されれば成功

ここまでで以下が動いています。

- **ConoHa VPS 1 台**
- その上で **Dokploy 本体 + Traefik + 自動 HTTPS 基盤 + メタデータ DB**
- さらにその上で **`hello-world` アプリ** が Dokploy 経由でビルド・デプロイされ、Traefik 経由で公開

「VPS 1 台 + Dokploy = 自分だけの PaaS」というストーリーがちゃんと完結しました。

---

## ハマりポイント

### `sudo -E` を忘れて環境変数が剥がれる

これが一番多いハマりです。`DOKPLOY_VERSION` を export したのに反映されていない、`ADVERTISE_ADDR` を指定したのに無視される、などの症状が出たら、ほぼ確実に `-E` を付け忘れています。

### ポート競合

公式 `install.sh` は `:80` / `:443` / `:3000` のいずれかが既に使われていると停止します。ConoHa の素のイメージなら大丈夫ですが、何かを動かしたサーバーに後追いで入れる場合は `ss -tulnp` で先に確認しておくのが安全です。

### Swarm overlay の CIDR 衝突

`10.20.0.0/16` をデフォルトで使うようにしていますが、それでも社内 VPN と衝突する場合は環境変数で別の範囲を指定できます。

```bash
export DOCKER_SWARM_INIT_ARGS="--default-addr-pool 172.30.0.0/16 --default-addr-pool-mask-length 24"
sudo -E bash install-on-conoha.sh
```

### アンインストール時に「volume is in use」

Dokploy をきれいに消す手順では、`docker service rm` のあとすぐ `docker volume rm` すると、Swarm がタスクコンテナを非同期で reap するため `volume is in use` で失敗することがあります。サンプルの README では以下の wait ループを挟んでいます。

```bash
docker service rm dokploy dokploy-postgres dokploy-redis
while docker ps -aq --filter "label=com.docker.swarm.service.name" | grep -q .; do sleep 1; done
docker rm -f dokploy-traefik
docker volume rm dokploy dokploy-postgres dokploy-redis
```

---

## まとめ

| 項目 | 内容 |
|------|---|
| デプロイ対象 | Dokploy v0.28.8（OSSのVercel/Heroku代替） |
| 使うコマンド | `conoha server create` + `conoha server ssh` + `install-on-conoha.sh` |
| 使わないコマンド | `conoha app deploy`（理由は本文参照） |
| 推奨フレーバー | `g2l-t-4`（4GB RAM） |
| Claude Code 経由 | 「Dokploy を入れて」と日本語で頼むだけ |
| サンプル | [crowdy/conoha-cli-app-samples/dokploy](https://github.com/crowdy/conoha-cli-app-samples/tree/main/dokploy) |

このシリーズでは「`compose.yml` 1 個で済むものは `conoha app deploy` で」「Docker Swarm を必要とする PaaS コントローラは `conoha server ssh` + 公式インストーラで」という棲み分けにしています。Dokploy はその後者の代表例で、用途的には「VPS 1 台に `compose.yml` 系サンプルをぶん投げる」よりも、「VPS 1 台に Dokploy を入れて、その上で `compose.yml` 系サンプルを Web UI から管理する」ほうが向いている人もいると思います。

そして強調しておきたいのは、この **「サーバー作成 → SSH → スクリプト実行」の 3 ステップを Claude Code に丸投げできる** ということです。`conoha-cli` に同梱の skill を入れておけば、「ConoHa に Dokploy をインストールして」と日本語で頼むだけで、すべて自動で進みます。コマンドを覚える必要も、フレーバー名を調べる必要もありません。

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)

