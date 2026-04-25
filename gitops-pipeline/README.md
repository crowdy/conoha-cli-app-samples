# gitops-pipeline

`main` ブランチへのマージをトリガーに、セルフホステッドランナー上で `conoha app deploy` を実行して ConoHa VPS にアプリを自動デプロイする完結型サンプルです。

## 全体像

```
Developer ──PR──▶ GitHub ──merge to main──▶ GitHub Actions
                                                 │
                                                 ▼
                                    Self-hosted runner (VPS #1)
                                                 │
                                                 ▼
                                    conoha app deploy (over SSH)
                                                 │
                                                 ▼
                                    App VPS (VPS #2, behind conoha-proxy)
```

- **VPS #1**: `github-actions-runner` サンプルで用意するセルフホステッドランナー。
- **VPS #2**: 本サンプルの Next.js アプリを動かすターゲット。`conoha-proxy` による blue/green 切替で無停止デプロイ。

1 台構成に統合することも可能ですが、runner がデプロイ対象と同じ VPS を壊すリスクを避けるため 2 台分離を推奨します。

## 構成

- [Next.js 15](https://nextjs.org/) — `app/` 配下のミニマルなページ。デプロイされたコミット SHA とタイムスタンプを表示します。
- `.github/workflows/deploy.yml` — テスト → main マージ時のデプロイ、の 2 ジョブ構成。
- `compose.yml` / `conoha.yml` — 他サンプルと同じ proxy モード (blue/green) 前提。

### このディレクトリの `.github/` について

GitHub Actions はリポジトリルートの `.github/workflows/` しか読みません。本サンプル内の `.github/workflows/deploy.yml` は **アクティブではなく**、この monorepo が main にマージされても起動しません。利用者は下の「使い方」に従い、このディレクトリを自分のアプリリポジトリのルートへコピーしてください。

## 前提条件

1. **conoha-cli** がローカルに `v0.6.0` 以上でインストール済み
2. **ConoHa VPS3 アカウント** とテナント ID / API パスワード
3. **セルフホステッドランナー** が稼働中 (→ `github-actions-runner` サンプル参照)
   - runner のホストに `conoha-cli` がインストールされていること
4. **アプリ用 VPS** が `conoha app init` 済み
5. **SSH キーペア** (runner からアプリ VPS へ SSH できること)

## 使い方

### 1. アプリ VPS を初期化

```bash
conoha server create --name appserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
conoha app init --app-name gitops-pipeline appserver
```

`conoha.yml` の `hosts:` を自分の FQDN に書き換え、DNS A レコードを VPS の public IP に向けてください。

### 2. 自分のアプリリポジトリを作成

本ディレクトリの内容をそのまま新しい GitHub リポジトリにコピーします。`.github/` もルートに置いてください。

```bash
cp -r gitops-pipeline/. /path/to/your-repo/
cd /path/to/your-repo
git init && git add . && git commit -m "initial"
git remote add origin https://github.com/you/your-repo.git
git push -u origin main
```

### 3. リポジトリの Secrets / Variables を設定

**Settings > Secrets and variables > Actions** で以下を登録します。

#### Repository secrets

| 名前 | 内容 |
|---|---|
| `CONOHA_TENANT_ID` | ConoHa テナント ID |
| `CONOHA_USERNAME` | ConoHa API ユーザー名 |
| `CONOHA_PASSWORD` | ConoHa API パスワード |
| `CONOHA_SSH_PRIVATE_KEY` | runner → アプリ VPS 用秘密鍵 (PEM 本体) |

#### Repository variables

| 名前 | 内容 |
|---|---|
| `CONOHA_SERVER_NAME` | アプリ VPS 名 (`conoha server list` で確認) |
| `CONOHA_SERVER_HOST` | アプリ VPS の public IP または FQDN (`ssh-keyscan` 用) |

### 4. PR → merge で自動デプロイ

1. 適当にブランチを切って `app/page.tsx` を編集。
2. Pull Request を開くと `test` ジョブ (型チェック + ビルド) が走ります。
3. レビュー後 `main` にマージすると `deploy` ジョブが起動:
   - conoha-cli に API 認証
   - `conoha app env set` で `DEPLOY_SHA` / `DEPLOY_TIMESTAMP` を注入
   - `conoha app deploy` で blue/green 切替
4. `https://<あなたの FQDN>/` にアクセスすると、ページにコミット SHA が反映されています。

## 仕組み

### 認証

`conoha auth login` は `CONOHA_TENANT_ID` / `CONOHA_USERNAME` / `CONOHA_PASSWORD` / `CONOHA_NO_INPUT=1` の環境変数が揃っていれば対話プロンプトをスキップします。`CONOHA_CONFIG_DIR=$RUNNER_TEMP/conoha` を指定してランナーの `$HOME` を汚さないようにしています。

### デプロイ

`conoha app deploy` は現在のディレクトリを tar.gz 化し、SSH 経由で VPS にアップロードして新しい slot (blue/green の片方) で `docker compose up -d` を走らせます。`conoha-proxy` がヘルスチェックしてから旧 slot からトラフィックを切り替えます。

### 環境変数の受け渡し

デプロイ直前に workflow が `.env` を生成し、`conoha app deploy` が同梱する tar に含めてターゲットへ届けます。docker compose は compose ファイルと同じディレクトリの `.env` を自動で読み込むため、`compose.yml` の `${DEPLOY_SHA:-dev}` 展開がそのまま機能します。ページ側は `process.env.DEPLOY_SHA` として読みます (`app/page.tsx`)。

> **補足**: proxy モードでは `conoha app env set` が slot に反映されない既知の挙動があるため ([conoha-cli#94](https://github.com/crowdy/conoha-cli/issues/94))、本サンプルは proxy / no-proxy 両対応の `.env` 同梱方式を採っています。`.env` は `.gitignore` 済みなのでリポジトリには残りません。

## 動作確認

```bash
# runner に向けて手動でワークフローを発火
gh workflow run deploy.yml

# 状態
gh run list --workflow deploy.yml

# ターゲット VPS 上のスロット
conoha app status --app-name gitops-pipeline appserver
```

## 既知の制限

- **シークレット漏れ**: runner はデプロイ用 API 資格情報と SSH 鍵を保持します。**public リポジトリの self-hosted runner は避けて**ください (PR からの任意コード実行で漏洩します)。公式ドキュメント: <https://docs.github.com/en/actions/security-guides/security-hardening-for-self-hosted-runners>。
- **ロールバック**: 本サンプルは `git revert` → `main` push による再デプロイに頼っています。旧スロットへ即時に戻したいときは runner にログインして `conoha app rollback <server>` を手動実行してください。
- **テスト層**: `test` ジョブは型チェック + ビルドのみ。単体/E2E テストは各プロジェクトで追加してください (`npm test` を `package.json` の `scripts` に追記すれば workflow の `npm run test` がそれを拾います)。

## 参考

- [`github-actions-runner`](../github-actions-runner/) — 本サンプルの前提となる runner
- [conoha-cli README](https://github.com/crowdy/conoha-cli)
- [Qiita: GitHub Actions × ConoHa で GitOps](https://qiita.com/crowdy/items/ec1855c36bd08e2f0c48)
