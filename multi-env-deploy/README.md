# multi-env-deploy

ブランチ名に応じて staging / production の異なる ConoHa VPS にデプロイ先を切り替えるサンプルです。`develop` → staging、`main` → production。GitHub Environments の承認フローと組み合わせて、production リリース前の手動承認を強制できます。

## 前提

- このサンプルは [`gitops-pipeline`](../gitops-pipeline/) の自然な拡張です。先にそちらの README を読むと前提が掴めます。
- セルフホステッドランナーは [`github-actions-runner`](../github-actions-runner/) サンプルで用意してください。
- conoha-cli は runner ホストに `v0.6.0` 以上で導入済みであること。

## 構成

```
develop branch ──▶ Actions ──▶ Self-hosted runner ──▶ conoha app deploy ──▶ Staging VPS
main    branch ──▶ Actions ──▶ Self-hosted runner ──▶ conoha app deploy ──▶ Production VPS
                                                       (人間承認を挟める)
```

- 1 つのワークフローファイルで両環境を扱います。
- `environment:` キーが GitHub Environments を切り替え、その下にある **環境別の Secrets / Variables** が `CONOHA_SERVER_NAME` / `CONOHA_SERVER_HOST` / SSH 鍵をすり替えます。

## 使い方

### 1. 2 台の VPS を初期化

```bash
# Staging
conoha server create --name staging --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
conoha app init --app-name multi-env-deploy staging

# Production
conoha server create --name production --flavor g2l-t-4 --image ubuntu-24.04 --key mykey
conoha app init --app-name multi-env-deploy production
```

各 VPS の `conoha.yml` の `hosts:` を環境ごとの FQDN (例: `staging.example.com`, `example.com`) に書き換えます。

### 2. 自分のアプリリポジトリへコピー

```bash
cp -r multi-env-deploy/. /path/to/your-repo/
cd /path/to/your-repo
git init && git checkout -b main
git add . && git commit -m "initial"
git remote add origin https://github.com/you/your-repo.git
git push -u origin main
git checkout -b develop && git push -u origin develop
```

### 3. GitHub Environments を設定

**Settings > Environments** で 2 つ作成します。

#### `staging` Environment

| 種別 | 名前 | 内容 |
|---|---|---|
| Secret | `CONOHA_TENANT_ID` | ConoHa テナント ID |
| Secret | `CONOHA_USERNAME` | API ユーザー名 |
| Secret | `CONOHA_PASSWORD` | API パスワード |
| Secret | `CONOHA_SSH_PRIVATE_KEY` | staging 用秘密鍵 |
| Variable | `CONOHA_SERVER_NAME` | 例: `staging` |
| Variable | `CONOHA_SERVER_HOST` | staging VPS の IP/FQDN |

#### `production` Environment

同じキー名で **production 用の値** を登録します。さらに **Required reviewers** を有効にして、main マージ後に人間の承認を挟むのが推奨。

> Environments を分離する目的: staging への push が誤って production の SSH 鍵やテナントにアクセスする事故を防ぎます。

### 4. 動かす

```bash
# Staging へデプロイ
git checkout develop && git push

# Production へデプロイ (main へマージ後、Environments の承認待ちに入る)
git checkout main && git merge develop && git push
```

ページの右上にバッジ (`STAGING` / `PRODUCTION`) が出るので、どちらに繋いでいるか即座に分かります。

## ワークフローの仕組み

```yaml
environment: ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
```

- GitHub Actions は `environment:` の値で Environment を解決し、その Environment の Secrets / Variables を `secrets.*` / `vars.*` に注入します。
- production の **Required reviewers** が有効な場合、ジョブはここで pause し承認待ちになります。
- 並列 push を避けるため `concurrency` を `${{ github.ref }}` 単位で組み、staging と production の同時進行は許容、同一 branch の重複起動は直列化します。

## 既知の制限

- **`pull_request` イベントは secrets を持ちません**。本サンプルは `pull_request` で `test` だけ走らせ、`deploy` は `push` のみに絞っています。
- **ロールバック**: Environment 越しの自動ロールバックは未実装。事故った場合は production runner で `conoha app rollback <server>` を手動実行してください。
- **環境変数**: `.env` 同梱方式のため、`docker-compose` の `${VAR:-default}` 展開を経由します。秘匿情報を `.env` に入れる場合は、リポジトリに残らないよう注意 (`.gitignore` 済み)。

## 関連サンプル

- [`gitops-pipeline`](../gitops-pipeline/) — シングル環境版
- [`github-actions-runner`](../github-actions-runner/) — runner 自体
