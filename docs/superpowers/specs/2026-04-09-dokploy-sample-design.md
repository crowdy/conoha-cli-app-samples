# dokploy Sample Design Spec

## Overview

Add a new sample `dokploy/` to `conoha-cli-app-samples`. The sample sets up
[Dokploy](https://dokploy.com/) — a self-hosted PaaS (Heroku/Vercel/Netlify
alternative) — on a single ConoHa VPS3 instance, then walks the reader through
deploying their first app (`hello-world` from this same repo) via the Dokploy
dashboard.

**Goal**: end-to-end story of "one ConoHa VPS + Dokploy = your own PaaS",
ending with the reader having Dokploy running and at least one app deployed
through it.

**What makes this sample different from the others**:
unlike every other sample in the repo, this one does not use the
`conoha app deploy` workflow. Dokploy is a PaaS controller that runs on Docker
Swarm and is installed via an official `install.sh`. A faithful `compose.yml`
reproduction is impractical (see Background below). The sample is therefore
honest about its different shape — it ships an `install.sh` wrapper instead.

## Background: why no compose.yml

Dokploy's official installer (`https://dokploy.com/install.sh`) does the
following on a fresh host, in order:

1. `docker swarm init --advertise-addr <private-ip>` (with optional
   `--default-addr-pool` to avoid CIDR conflicts).
2. `docker network create --driver overlay --attachable dokploy-network`.
3. `mkdir -p /etc/dokploy && chmod 777 /etc/dokploy` (used as a host bind mount
   for Traefik config and Dokploy state).
4. Generates a random Postgres password and stores it as a Docker Swarm secret
   (`docker secret create dokploy_postgres_password`).
5. `docker service create` for `dokploy-postgres`, `dokploy-redis`, and
   `dokploy` (the main app), all constrained to `node.role==manager`, attached
   to `dokploy-network`, with the secret mounted at
   `/run/secrets/postgres_password`.
6. `docker run` (not `service create`) for `dokploy-traefik` with host-mode
   ports 80/443 + a UDP 443 publish, then `docker network connect` to attach
   Traefik to the overlay.

This combination — Swarm secrets + overlay network + manager constraint +
host-mode publishes + a Traefik container that is intentionally not a Swarm
service — cannot be expressed as a single `docker compose up` workflow that
`conoha app deploy` could run. The brainstorming session evaluated and
rejected three alternatives (a docker stack compose file, a placeholder
compose.yml, and a hybrid approach) in favor of an honest install.sh wrapper.

## Directory layout

```
dokploy/
├── README.md             # Main documentation (Japanese, matches sibling samples)
└── install-on-conoha.sh  # Thin ConoHa-specific bootstrap that calls install.sh
```

Two files only. No `compose.yml`, no `init/`, no auxiliary YAML.

## install-on-conoha.sh

A thin wrapper around the upstream `install.sh`. Its only job is to add value
that is specific to ConoHa VPS or to reproducibility, then delegate.

**Responsibilities**:

1. `set -euo pipefail` at the top.
2. Verify the script is running as root (the upstream installer requires it).
3. Pre-check that ports 80, 443, and 3000 are free; fail fast with a clear
   message if not.
4. Honor `DOKPLOY_VERSION` if the user exported it; otherwise default to a
   specific tagged release (the latest stable Dokploy release at the time of
   implementation, e.g. `v0.26.x`) — never `latest` or `canary`. The pinned
   version string lives at the top of the script as a single editable
   variable so future bumps are a one-line change.
5. Set `DOCKER_SWARM_INIT_ARGS="--default-addr-pool 10.20.0.0/16
   --default-addr-pool-mask-length 24"` by default to leave room around
   ConoHa's private network. Allow the user to override by exporting the
   variable before running the script.
6. Run `curl -fsSL https://dokploy.com/install.sh | bash`.
7. On success, print the dashboard URL (`http://<server-ip>:3000`) and a
   short "next steps" block (3-4 lines).

**Explicitly out of scope** (YAGNI):

- Installing Docker — the upstream installer handles it.
- Initializing Swarm / creating networks / creating secrets — upstream's job.
- Uninstall logic — documented as commands in the README, not automated.
- Automatic detection of the public IP — upstream already does this.

The wrapper exists so that the README can explain "why this one line" and so
that ConoHa-specific defaults live in one auditable place.

## README.md structure

Japanese, same tone and section ordering as `gitea/README.md` and
`coolify/README.md`. Target length: 200-300 lines, comparable to other
mid-sized samples. No screenshots — text only.

Sections (in order):

1. **Title + one-line description** — `# dokploy` and a 1-2 line description
   of what Dokploy is.
2. **⚠️ Notice block** — explicit callout that this sample does not use
   `conoha app deploy` and is install.sh based, with a one-sentence reason
   (Dokploy is itself a PaaS controller, runs on Swarm).
3. **Tech stack table** — Dokploy, Traefik, PostgreSQL, Redis, Docker Swarm,
   with versions.
4. **Architecture diagram** — ASCII diagram of the four services
   (postgres / redis / dokploy / traefik) on the `dokploy-network` overlay,
   on a single Swarm node.
5. **Directory layout** — README + install-on-conoha.sh, two files.
6. **Prerequisites** — conoha-cli installed, VPS3 account, SSH key, **g2l-t-4
   (4GB) recommended**.
7. **Deploy steps**:
   - `conoha server create --flavor g2l-t-4 ...`
   - `conoha server ssh myserver`
   - Inside the server:
     `curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh | sudo bash`
   - Alternative: clone the repo and run the script locally.
8. **Verification** — open `http://<IP>:3000`, create the initial admin user,
   land on the dashboard.
9. **🎯 First app deploy walkthrough: hello-world** — the scope-B core:
   - In Dokploy: New Project → "demo".
   - Add Application → Provider: Public Git.
   - Repository: `https://github.com/crowdy/conoha-cli-app-samples`.
   - Branch: `main` / Build Path: `hello-world` / Build Type: `Dockerfile`.
   - Domain: use the auto-generated `*.traefik.me` hostname; fall back to
     server IP + auto-assigned port if `*.traefik.me` does not resolve.
   - Click Deploy, watch the logs, open the resulting URL in the browser.
10. **💡 Tip: Templates Marketplace** — 1-2 lines noting that Pocketbase /
    Plausible / Cal.com etc. can be deployed in one click from the Dokploy
    template marketplace.
11. **Production notes** — custom domain + automatic HTTPS via Let's Encrypt,
    backups, pinning `DOKPLOY_VERSION`.
12. **Uninstall** — copy-pasteable command block that mirrors the upstream
    installer's structure: `docker service rm dokploy dokploy-postgres
    dokploy-redis`, `docker rm -f dokploy-traefik`, `docker secret rm
    dokploy_postgres_password`, `docker network rm dokploy-network`, `docker
    volume rm dokploy dokploy-postgres dokploy-redis`, `docker swarm leave
    --force`, and `rm -rf /etc/dokploy`.
13. **Troubleshooting** — port conflicts, Swarm CIDR collisions, the meaning
    of `chmod 777 /etc/dokploy`.
14. **Related links** — Dokploy official docs.

The walkthrough section is written in terms of *intent* ("Add an Application
from a Public Git source, point Build Path at hello-world") rather than
specific UI labels, so it survives Dokploy UI changes.

## Root README.md changes

Add a single row to the sample table in the repo root `README.md`, inserted
right after `coolify` to keep the PaaS-style samples grouped:

```markdown
| [dokploy](dokploy/) | Dokploy + Traefik + PostgreSQL + Redis (Docker Swarm) | セルフホスティング PaaS（install.sh ベース） | g2l-t-4 (4GB) |
```

The phrase **"install.sh ベース"** in the description column is intentional
— it warns the reader before they click that the workflow differs from
every other sample.

**Files explicitly not touched**: `LICENSE`, `.gitignore`, the "使い方" /
prerequisites section of the root `README.md` (those describe the standard
`conoha app deploy` flow, which this sample is an exception to), and any
other sample directories.

## Error handling

In `install-on-conoha.sh`:

- `set -euo pipefail`.
- Root check failure → message "This script must be run as root", exit 1.
- Port 80 / 443 / 3000 already in use → list which ports are taken, suggest
  stopping the conflicting service, exit 1.
- `curl ... install.sh | bash` failure → propagate the upstream non-zero exit.
- On success → print dashboard URL and 3-4 line next-steps block.

The wrapper does **not** catch errors from the upstream installer or attempt
to retry. If upstream fails, the user sees the upstream error directly.

## Testing

Consistent with the rest of this repo, there are no automated tests. The
README includes a manual verification checklist:

- [ ] `conoha server create --flavor g2l-t-4 ...` succeeds.
- [ ] `install-on-conoha.sh` completes without error.
- [ ] `http://<IP>:3000` shows the Dokploy dashboard.
- [ ] Initial admin account can be created.
- [ ] The first-app walkthrough successfully deploys `hello-world` and the
      resulting URL serves the static page.
- [ ] The uninstall block fully reverts the host (`docker info` reports
      Swarm inactive, `/etc/dokploy` removed, no Dokploy volumes left).

The user is expected to run this checklist on a real VPS once after
implementation, same as every other sample in this repo.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Upstream `install.sh` changes its arguments or behavior, breaking the wrapper's assumptions. | The wrapper pins `DOKPLOY_VERSION` to a known stable release by default; bumping it is a one-line change. |
| Dokploy's default Swarm overlay CIDR (10.0.0.0/24) collides with a future ConoHa private network. | `DOCKER_SWARM_INIT_ARGS` defaults to `--default-addr-pool 10.20.0.0/16 --default-addr-pool-mask-length 24`. README documents how to override it. |
| Dokploy UI changes and the README walkthrough goes stale. | The walkthrough is written in terms of operation intent ("Add Application from a Public Git source, set Build Path to hello-world"), not UI labels. |
| User already has something on port 80/443/3000. | The wrapper detects this in the pre-check phase and exits with a clear message before invoking upstream. |
| `ss` / `ip` commands missing on the Ubuntu image. | `iproute2` is standard on ConoHa Ubuntu 24.04. The README documents Ubuntu 24.04 as a prerequisite. |

**Accepted unknowns** (will be confirmed during implementation, with documented
fallbacks):

- Whether Dokploy's "Public Git" application source supports a `Build Path`
  pointing at a monorepo subdirectory in the current release. If it does not,
  the README falls back to "fork the repo and keep only `hello-world/`".
- Whether `*.traefik.me` wildcard DNS resolves cleanly from a ConoHa egress
  IP. If not, the walkthrough falls back to the server IP plus the auto-
  assigned port that Dokploy displays in the dashboard.

## Out of scope

These were considered during brainstorming and explicitly excluded:

- Custom domain + Let's Encrypt setup as part of the main flow
  (mentioned only in "Production notes").
- Multi-server Swarm with worker nodes.
- Automated upgrade tooling beyond what `install.sh update` already provides.
- Screenshots in the README.
- Any modification to other samples in the repo to make them "Dokploy-aware".
