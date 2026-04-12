---
title: conoha-cliでGitHub Actionsセルフホステッドランナーを ConoHa VPS にワンコマンドデプロイ
tags: GitHubActions GitHub Docker Conoha conoha-cli
author: crowdy
slide: false
---
## はじめに

GitHub Actions の CI/CD をプライベートリポジトリで大量に回していると、**無料枠の分数制限** が気になってきます。特に Docker ビルドやE2Eテストなど重いジョブを含むワークフローでは、セルフホステッドランナーを自前のサーバーで動かすほうがコスト的にも速度的にも有利です。

この記事では、GitHub Actions のセルフホステッドランナーを ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。Docker-in-Docker に対応した [myoung34/github-runner](https://github.com/myoung34/docker-github-actions-runner) イメージを使い、**compose.yml 1ファイル**だけで完結します。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からランナー起動まで、手元のターミナルだけで完結します。

## セルフホステッドランナーとは

GitHub Actions は通常、GitHub が提供する共有ランナー（`ubuntu-latest` 等）上でジョブを実行します。セルフホステッドランナーは、自分のサーバー上で GitHub Actions のジョブを処理するための仕組みです。

| 項目 | GitHub ホステッド | セルフホステッド |
|------|------------------|-----------------|
| **コスト** | 無料枠あり（超過分は課金） | サーバー代のみ |
| **性能** | 2 vCPU / 7GB RAM（標準） | VPS スペック次第 |
| **Docker ビルド** | 毎回レイヤーキャッシュなし | ボリュームでキャッシュ永続化可能 |
| **ネットワーク** | GitHub 管理のIP | 固定IP（VPN・ファイアウォール連携可） |
| **カスタマイズ** | 制限あり | 自由（GPU、特定ツール等） |

プライベートリポジトリで月2,000分以上 CI を回しているなら、VPS 1台のほうが安くなるケースが多いです。

## ファイル構成

```
github-actions-runner/
├── compose.yml    # これだけ
└── README.md
```

compose.yml 1ファイルのみという、シリーズ最小の構成です。Dockerfile すらありません。公開されている Docker イメージをそのまま使います。

## compose.yml

```yaml
services:
  runner:
    image: myoung34/github-runner:2.333.1
    environment:
      - REPO_URL=${REPO_URL}
      - ACCESS_TOKEN=${ACCESS_TOKEN}
      - RUNNER_NAME=${RUNNER_NAME:-conoha-runner}
      - RUNNER_WORKDIR=/tmp/runner/work
      - LABELS=${RUNNER_LABELS:-self-hosted,linux,x64}
      - DISABLE_AUTO_UPDATE=1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - runner_work:/tmp/runner/work
    restart: unless-stopped

volumes:
  runner_work:
```

ポイントをいくつか解説します。

### Docker ソケットマウント

`/var/run/docker.sock` をコンテナにマウントすることで、ランナー内のジョブから Docker コマンドが使えます。CI でコンテナイメージをビルドしたり、`docker compose` でテスト環境を立ち上げたりできます。Docker-in-Docker（DinD）ではなく Docker-outside-of-Docker（DooD）方式なので、パフォーマンスへの影響は最小限です。

### 環境変数

| 変数 | 説明 | 必須 |
|------|------|------|
| `REPO_URL` | ランナーを登録するリポジトリまたは組織のURL | ✅ |
| `ACCESS_TOKEN` | GitHub Personal Access Token（`repo` スコープ） | ✅ |
| `RUNNER_NAME` | ランナー名（デフォルト: `conoha-runner`） | |
| `RUNNER_LABELS` | カスタムラベル（デフォルト: `self-hosted,linux,x64`） | |

`DISABLE_AUTO_UPDATE=1` は、GitHub が定期的にランナーバイナリを自動更新する機能を無効化しています。Docker イメージのバージョンで管理するため、予期しない更新を防ぎます。

### runner_work ボリューム

ランナーの作業ディレクトリを名前付きボリュームにマウントしています。これにより、ランナーコンテナが再起動してもワークスペースが保持されます。Docker レイヤーキャッシュも VPS 上に残るため、2回目以降のビルドが高速化します。

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/github-actions-runner
```

### 2. サーバー作成（既存サーバーがあればスキップ）

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey --wait
```

### 3. アプリ初期化

```bash
conoha app init myserver --app-name github-actions-runner
```

```
Initializing app "github-actions-runner" on vm-xxxxxxxx-xx (xxx.xxx.xxx.xxx)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
==> Installing post-receive hook...
==> Done!
```

### 4. 環境変数の設定

```bash
conoha app env set myserver --app-name github-actions-runner \
  REPO_URL=https://github.com/your-org/your-repo \
  ACCESS_TOKEN=ghp_xxxxxxxxxxxx
```

`ACCESS_TOKEN` には GitHub の Personal Access Token を指定します。Classic Token なら `repo` スコープ、Fine-grained Token なら対象リポジトリの「Administration」権限が必要です。本番環境では Fine-grained Token を推奨します。

### 5. デプロイ

```bash
conoha app deploy myserver --app-name github-actions-runner
```

```
Archiving current directory...
Uploading to vm-xxxxxxxx-xx (xxx.xxx.xxx.xxx)...
Building and starting containers...
 Image myoung34/github-runner:2.333.1 Pulling
 ...
 Container github-actions-runner-runner-1 Started
Deploy complete.
```

イメージの pull に1〜2分かかりますが、それ以外のビルドはありません。

## 動作確認

### ランナーの登録状態

デプロイ後、GitHub リポジトリの **Settings > Actions > Runners** にアクセスすると、ランナーが **Idle** 状態で表示されます。

```bash
conoha app status myserver --app-name github-actions-runner
```

```
NAME                             IMAGE                            STATUS    PORTS
github-actions-runner-runner-1   myoung34/github-runner:2.333.1   Up 30s
```

### ワークフローでの使い方

ワークフローの `runs-on` に `self-hosted` を指定するだけです。

```yaml
# .github/workflows/ci.yml
name: CI
on: push
jobs:
  build:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: echo "Running on ConoHa VPS!"
      - run: docker version  # Docker も使える
```

カスタムラベルを追加した場合は、`runs-on: [self-hosted, gpu]` のように配列で指定できます。

## カスタマイズ

### 複数ランナーの起動

CI ジョブを並列処理したい場合、`--scale` で複数ランナーを起動できます。

```bash
# VPS に SSH してスケールアウト
conoha server ssh myserver
docker compose -f /opt/conoha/github-actions-runner/compose.yml up -d --scale runner=3
```

3つのランナーが GitHub に登録され、最大3ジョブを同時に処理できます。

### 組織レベルのランナー

`REPO_URL` をリポジトリURLではなく組織URLに変更すると、組織内の全リポジトリで共有できます。

```bash
conoha app env set myserver --app-name github-actions-runner \
  REPO_URL=https://github.com/your-org
```

## 実際のプロジェクトでの活用例: Next.js アプリの自動デプロイ

セルフホステッドランナーの真価は、**main ブランチへのマージをトリガーに、ConoHa VPS へ自動デプロイする** ような CI/CD パイプラインで発揮されます。

ここでは、このシリーズの [Next.js サンプル](https://qiita.com/crowdy/items/2f764587145345fe7a07) を例に、PR マージ → 自動デプロイの流れを構築してみます。

### ワークフローファイル

```yaml
# .github/workflows/deploy.yml
name: Deploy to ConoHa
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to ConoHa
        run: conoha app deploy myserver --app-name nextjs
        env:
          CONOHA_USERNAME: ${{ secrets.CONOHA_USERNAME }}
          CONOHA_PASSWORD: ${{ secrets.CONOHA_PASSWORD }}
          CONOHA_TENANT_ID: ${{ secrets.CONOHA_TENANT_ID }}
```

**ポイント**:

- `runs-on: self-hosted` — ConoHa 上のランナーでジョブを実行
- `on: push: branches: [main]` — main への push（= PR マージ）でトリガー
- ConoHa の認証情報は GitHub リポジトリの **Settings > Secrets and variables > Actions** に登録

### PR マージ時にだけデプロイ、PR 作成時にはテストだけ

テストとデプロイを分離したい場合は、ジョブを分けます。

```yaml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  deploy:
    runs-on: self-hosted
    needs: test
    if: github.event_name == 'push'    # main への push 時のみ
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to ConoHa
        run: conoha app deploy myserver --app-name nextjs
```

`pull_request` イベントではテストだけ走り、main にマージされた `push` イベントでテスト → デプロイと進みます。

### GitHub ホステッドとの使い分け

セルフホステッドランナーと GitHub ホステッドランナーを同じワークフロー内で混在させることもできます。

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest      # 軽い処理は GitHub ホステッド
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run lint

  deploy:
    runs-on: self-hosted        # デプロイは ConoHa 上のランナー
    needs: lint
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - run: conoha app deploy myserver --app-name nextjs
```

lint のような軽量ジョブは GitHub ホステッドに任せ、Docker ビルドやデプロイなど重い処理だけセルフホステッドで実行する、というハイブリッド構成が実用的です。

## ハマりポイント: トークンのスコープ

Fine-grained Token を使う場合、リポジトリの「Administration」権限を Read and Write に設定する必要があります。「Actions」権限だけでは不十分です。ランナーの登録・削除にはリポジトリの管理者権限が必要なためです。

Classic Token の場合は `repo` スコープを付与すれば動作します。

## セキュリティに関する注意

セルフホステッドランナーは **プライベートリポジトリでの利用を推奨** します。パブリックリポジトリで使用すると、外部からのPull Requestでサーバー上で任意のコードが実行される可能性があります。

また、Docker ソケットをマウントしているため、ランナー内のジョブからホストの Docker デーモンにアクセスできます。信頼できるワークフローのみを実行するようにしてください。

## まとめ

`conoha app init` → `conoha app env set` → `conoha app deploy` の3ステップで、GitHub Actions セルフホステッドランナーを ConoHa VPS3 上にデプロイできました。

| 特徴 | 詳細 |
|------|------|
| **compose.yml のみ** | Dockerfile不要、イメージをそのまま利用 |
| **Docker ビルド対応** | ソケットマウントで CI 内から Docker 利用可 |
| **スケーラブル** | `--scale` で複数ランナーを即座に起動 |
| **ランナーバージョン** | myoung34/github-runner 2.333.1（2026年4月時点） |
| **自動復旧** | `restart: unless-stopped` でクラッシュ時も自動再起動 |

サンプル: https://github.com/crowdy/conoha-cli-app-samples/tree/main/github-actions-runner

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
- [myoung34/docker-github-actions-runner - GitHub](https://github.com/myoung34/docker-github-actions-runner)
- [GitHub Actions セルフホステッドランナー公式ドキュメント](https://docs.github.com/ja/actions/hosting-your-own-runners)
