# Setup Guide

## 1. Prerequisites

- ConoHa VPS3 account with `conoha-cli` installed
- SSH keypair registered with ConoHa (`conoha keypair create` if needed)
- GitHub Personal Access Token with `repo` scope
- Anthropic Pro or Max subscription (for Claude OAuth)

## 2. Deploy the runner

```bash
# Create a server. The flavor and image IDs vary per region — list them with
# `conoha flavor list` / `conoha image list` and substitute as needed. A
# 2 GB / 2-3 vCPU flavor (e.g. g2l-t-c3m2) is sufficient for runner + claude CLI.
conoha server create --name doc-reviewer \
  --flavor <flavor-id> --image <ubuntu-24.04-image-id> \
  --key-name mykey \
  --security-group default --security-group IPv4v6-SSH

# Initialize the app on the server (installs Docker + sets up /opt/conoha/<app>).
conoha app init doc-reviewer --app-name github-pr-doc-reviewer

# Configure the runner's environment via a local .env.server file in this
# sample directory. `conoha app deploy` materialises that file into the
# server-side `.env` that docker compose reads at `docker compose up` time.
cd github-pr-doc-reviewer/
( umask 077 && cat > .env.server <<'EOF'
REPO_URL=https://github.com/your-org/your-spec-repo
ACCESS_TOKEN=ghp_xxxxxxxxxxxx
RUNNER_NAME=doc-reviewer
RUNNER_LABELS=self-hosted,linux,x64,doc-reviewer
EOF
)

# Deploy: archives the directory, uploads via SSH, runs `docker compose up`.
conoha app deploy doc-reviewer --app-name github-pr-doc-reviewer
```

> **Note on `conoha app env set`** — `conoha-cli` exposes
> `conoha app env set/list` for storing per-app environment variables on
> the server. With current `conoha-cli` (verified at `c3j1` region, mid-2026)
> those values are **not** read by `docker compose`'s `${VAR}` substitution
> at `compose up` time, so the runner came up with empty `REPO_URL` /
> `ACCESS_TOKEN`. The `.env.server` path above is what reliably works for
> this sample. If you find `conoha app env set` propagating correctly in
> your environment, please open an issue with details so we can revisit
> the recommendation.

> The repository root `.gitignore` already excludes `.env.server`, so the
> file stays local. Do not commit it. The `( umask 077 && cat > … )`
> subshell creates the file mode `0600` from the start, which avoids the
> brief world-readable window of a plain `cat` followed by `chmod 600`.

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

## 5. Security

Read this section before adding the workflow. The runner has persistent Anthropic OAuth credentials and (by default) a mounted host Docker socket. A misconfigured workflow can leak both.

### Pin the action to a SHA, not `@main`

The reference template uses `@main` for convenience while you evaluate the sample. Before relying on this in any repository you care about, change the `uses:` line to a 40-char commit SHA or release tag:

```yaml
- uses: crowdy/conoha-cli-app-samples/github-pr-doc-reviewer/action@<40-char-sha>
```

If you keep `@main`, any future commit to `crowdy/conoha-cli-app-samples` will execute on your VPS with your credentials. Pinning means upgrades become a deliberate decision: bump the SHA, audit the diff, then merge.

### Fork PRs

The reference template's `if:` guard refuses PRs whose head repo differs from the base repo (i.e., fork PRs). That is the safe default on a self-hosted runner.

Why fork PRs are dangerous on self-hosted runners: GitHub's `pull_request` event runs the workflow that exists in the **PR head** (the forker's branch). On a self-hosted runner that means a forker can edit `.github/workflows/doc-review.yml`, swap the `uses:` line for arbitrary code, and exfiltrate `~/.claude/.credentials.json` and `ACCESS_TOKEN` from the runner host before this action ever runs.

If you must accept fork PRs, the safe options are:

1. **Restrict the runner to a private repo only.** Forks of private repos already require collaborator access, which closes the threat.
2. **Use `pull_request_target`** (which runs against the base branch's workflow definition) and run only mechanical checks that do not check out fork code. This means the AI deep-review path cannot run on fork PRs.
3. **Manually merge fork PRs into a maintainer-controlled branch** (e.g., `review/fork-NN`) and let the doc reviewer run on that branch instead.

### Repository setting: require approval for first-time contributors

In GitHub: **Settings → Actions → General → Fork pull request workflows from outside collaborators → Require approval for first-time contributors** (or the stricter "Require approval for all outside collaborators"). This adds a manual gate before any contributor-triggered run reaches the self-hosted runner.

### GitHub token scope

`ACCESS_TOKEN` is used by the runner to register with GitHub. Use the minimum scope:

- For a public repo: `repo:public_repo` (or `public_repo` on a fine-grained PAT scoped to the single repo).
- For a private repo: a fine-grained token scoped to that repo with `Actions: read+write` and nothing more.

The classic `repo` scope grants access to all your repos and should not be used here.

### Docker socket exposure

`compose.yml` inherits `myoung34/github-runner`'s mount of `/var/run/docker.sock`. This lets the runner spawn Docker containers — useful for some workflows but not required by this sample. If your other workflows on this runner do not need Docker-in-Docker, remove the `volumes:` mount to reduce blast radius:

```yaml
# compose.yml
services:
  runner:
    # volumes:
    #   - /var/run/docker.sock:/var/run/docker.sock   # remove if unused
```

> **Compatibility caveat.** Because the container runs as the unprivileged
> `runner` user (UID 1001) — see `RUN_AS_ROOT=false` and `USER runner` in
> the Dockerfile/`compose.yml` — UID 1001 inside the container has no
> membership in the host's `docker` group, so the mounted socket is **not
> usable by default**. The threat surface is correspondingly smaller, but
> Docker-in-Docker workflows on this runner will fail with `permission
> denied` on the socket. If you need DinD, add the host's docker GID via
> `group_add` in `compose.yml`:
>
> ```yaml
> # compose.yml — only if you need Docker-in-Docker on this runner.
> services:
>   runner:
>     group_add:
>       - "${DOCKER_GID:-999}"   # host's `getent group docker | cut -d: -f3`
> ```
>
> This restores DinD usability while keeping the runner non-root.

## 6. Add the workflow to your spec repo

Copy `workflow-template/doc-review.yml` to your spec repo at `.github/workflows/doc-review.yml`. See `user-guide.md` for usage.
