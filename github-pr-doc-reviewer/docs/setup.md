# Setup Guide

## 1. Prerequisites

- ConoHa VPS3 account with `conoha-cli` installed
- SSH keypair registered with ConoHa (`conoha keypair create` if needed)
- GitHub Personal Access Token with `repo` scope
- Anthropic Pro or Max subscription (for Claude OAuth)

## 2. Deploy the runner

```bash
# Create a server (g2l-t-2 = 2 GB; sufficient for runner + claude CLI)
conoha server create --name doc-reviewer --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# Initialize the app
conoha app init doc-reviewer --app-name github-pr-doc-reviewer

# Set environment
conoha app env set doc-reviewer --app-name github-pr-doc-reviewer \
  REPO_URL=https://github.com/your-org/your-spec-repo \
  ACCESS_TOKEN=ghp_xxxxxxxxxxxx \
  RUNNER_LABELS=self-hosted,linux,x64,doc-reviewer

# Deploy
conoha app deploy doc-reviewer --app-name github-pr-doc-reviewer
```

For an organization-level runner, set `REPO_URL=https://github.com/your-org`.

## 3. One-time Claude authentication

The runner needs an OAuth token from your Anthropic subscription. Run `claude` interactively once:

```bash
ssh ubuntu@<vps-ip>
docker exec -it $(docker ps -qf name=runner) claude
# Follow the device-code prompt — opens https://claude.ai/oauth/device on a separate machine.
# After confirming, exit with Ctrl-D.
```

The credentials persist in the `claude_home` Docker volume across container restarts and redeployments.

## 4. Verify the runner

In your GitHub repository settings → Actions → Runners, the runner should show **Idle** with the labels you configured.

```bash
docker logs <container> --tail 50
# Should include: "[doc-reviewer] Claude OAuth credentials detected"
```

## 5. Add the workflow to your spec repo

Copy `workflow-template/doc-review.yml` to your spec repo at `.github/workflows/doc-review.yml`. See `user-guide.md` for usage.
