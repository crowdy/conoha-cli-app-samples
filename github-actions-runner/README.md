# github-actions-runner

GitHub Actions のセルフホステッドランナーを ConoHa VPS 上で実行します。プライベートリポジトリの CI/CD を自前サーバーで処理できます。

## 構成

- [GitHub Actions Runner](https://github.com/myoung34/docker-github-actions-runner) — セルフホステッドランナー（Docker-in-Docker 対応）
- Docker ソケットマウントで Docker ビルドも可能

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- GitHub Personal Access Token（`repo` スコープ）

## デプロイ

```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name github-actions-runner

# 環境変数を設定（必須）
conoha app env set myserver --app-name github-actions-runner \
  REPO_URL=https://github.com/your-org/your-repo \
  ACCESS_TOKEN=ghp_xxxxxxxxxxxx

# デプロイ
conoha app deploy myserver --app-name github-actions-runner
```

## 動作確認

1. GitHub リポジトリの Settings > Actions > Runners でランナーが **Idle** 状態を確認
2. ワークフローに `runs-on: self-hosted` を指定してジョブを実行

## カスタマイズ

- `RUNNER_LABELS` でカスタムラベルを追加（例: `gpu,large`）
- 組織レベルのランナーにする場合は `REPO_URL` を `https://github.com/your-org` に変更
- 複数ランナーを起動するには `docker compose up -d --scale runner=3`
- 本番環境では `ACCESS_TOKEN` に Fine-grained Token を推奨
