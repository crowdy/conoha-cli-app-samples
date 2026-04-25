# chatops-deploy

PR コメントに `/deploy` と書いた瞬間にセルフホステッドランナー経由で ConoHa VPS へデプロイが走る ChatOps サンプルです。

```
@alice: /deploy production
👀 (reaction by bot)
🚀 Deploying abc1234 to **production**… (run)
✅ Deployed abc1234 to **production**.
```

サブコマンド: `/deploy` (デフォルト staging) / `/deploy staging` / `/deploy production`。

## 前提

- [`gitops-pipeline`](../gitops-pipeline/) と [`multi-env-deploy`](../multi-env-deploy/) サンプルを先に読むと前提が整理しやすいです。
- セルフホステッドランナーは [`github-actions-runner`](../github-actions-runner/)。
- conoha-cli は runner ホストに `v0.6.0` 以上で導入済みであること。

## 構成

```
PR comment "/deploy [env]"
        │
        ▼
parse job (ubuntu-latest)
   ├─ 👀 reaction
   ├─ permission check (write+ only)
   ├─ subcommand parse
   └─ resolve PR head SHA / refuse fork PRs
        │
        ▼
deploy job (self-hosted, environment: staging|production)
   ├─ 🚀 starting comment
   ├─ checkout PR head SHA
   ├─ conoha auth login + app deploy
   ├─ ✅ success comment / ❌ failure comment
```

ワークフローは 2 ジョブ構成:
1. `parse` (`ubuntu-latest`): セルフホステッドリソースを使わずに権限と引数を捌く。
2. `deploy` (`self-hosted`): 実デプロイ。`environment:` に staging または production を渡し、environment ごとの secrets / approval rules を活用。

## 使い方

### 1. VPS と Environments を準備

[`multi-env-deploy`](../multi-env-deploy/README.md) の手順 1 / 3 と同じです。staging と production の 2 つの GitHub Environment にそれぞれ:

- Secrets: `CONOHA_TENANT_ID`, `CONOHA_USERNAME`, `CONOHA_PASSWORD`, `CONOHA_SSH_PRIVATE_KEY`
- Variables: `CONOHA_SERVER_NAME`, `CONOHA_SERVER_HOST`

を登録してください。

> production には **Required reviewers** を設定するのを推奨。`/deploy production` 後に Environment 承認待ちになります。

### 2. リポジトリへコピー

```bash
cp -r chatops-deploy/. /path/to/your-repo/
```

ルートの `.github/workflows/deploy.yml` がそのまま動きます。

### 3. PR コメントで動かす

```
/deploy            ← staging へ
/deploy staging
/deploy production ← Environment 承認後に実行
```

書いた瞬間に bot が 👀 をつけ、ジョブが進むにつれ 🚀 → ✅ / ❌ コメントが PR に積まれます。

## セキュリティの仕組み

ChatOps デプロイは **本番資格情報を任意のコメントトリガーに晒す** ので、ガードを 4 重にしています:

1. **`/deploy` のサブコマンド形を厳格に判定** — `==` または `startsWith('/deploy ')`。`/deployment` 等は弾く。`issue.pull_request` 条件で plain Issue コメントも無視。
2. **権限チェック** (`getCollaboratorPermissionLevel`) — コメント投稿者が `admin` / `maintain` / `write` のいずれかでなければ `core.setFailed`。
3. **fork PR 拒否** — `pr.head.repo.full_name != owner/repo` なら refuse。fork からの PR にコメントしてもデプロイは走りません。fork のコードを ship したい場合は base リポジトリにブランチを push し直してから `/deploy`。
4. **コメント本文は env 変数経由でしか参照しない** — `${{ github.event.comment.body }}` を直接シェルや `github-script` テンプレートに展開すると script injection が発生するので、必ず `env: COMMENT_BODY: ...` 経由で受け、シェル変数として扱う。([GitHub Security hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-an-intermediate-environment-variable))

加えて、`issue_comment` イベントは **デフォルトブランチのワークフローファイル** を使うため、悪意ある PR が `.github/workflows/deploy.yml` を改ざんしても効きません。

## 既知の制限

- **古い PR コメント**: PR の HEAD は parse 時に取得するので、コメント投稿後に push があると **コメントを書いた時点の HEAD ではなく現在の HEAD** にデプロイされます。コメントに `/deploy <sha>` のような明示的 SHA 指定を実装する場合は、`parse` ジョブを拡張してください。
- **`environment` 承認待ちの間に PR が更新された場合**: production 承認のタイミングで PR head が動いていれば新しい SHA がデプロイされます。タグや特定 SHA を本番に固定したいなら GitHub Releases ベースの別ワークフローを推奨。
- **コメント連投**: `concurrency.group` を `chatops-deploy-${env}` で組んでいるので、同じ環境への並列デプロイは直列化します。

## 関連サンプル

- [`gitops-pipeline`](../gitops-pipeline/) — シングル環境のシンプルな自動デプロイ
- [`multi-env-deploy`](../multi-env-deploy/) — ブランチ分岐型 (push トリガー)
- [`github-actions-runner`](../github-actions-runner/) — runner 自体
