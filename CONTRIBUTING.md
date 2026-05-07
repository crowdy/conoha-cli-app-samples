# Contributing

## Secret-handling rules (must read)

This repository ships sample apps and recipes that get deployed to real
infrastructure. To prevent the kind of incident where production-looking
data leaks into samples or test fixtures, contributors **must** follow
these rules:

1. **Never commit a real secret.** No API keys, tokens, webhook secrets,
   passwords, private keys, OAuth client secrets, or session cookies —
   anywhere in the repo, including blog posts, design docs, plans,
   handoff memos, screenshots, and CLI output examples.

2. **Mask infrastructure identifiers in committed text.** Replace real
   server IPs, VM IDs, hostnames, SSH key names, account/tenant IDs, and
   internal domains with placeholders such as `<SERVER_IP>`,
   `<YOUR_SSH_KEY_NAME>`, `<TENANT_ID>`. The reserved example IP ranges
   (RFC 5737: `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) are
   safe to use in documentation.

3. **Use `.env.example`, never `.env` or `.env.server`.** Anything ending
   in `.env` or `.env.server` is gitignored. If you need a template file
   to be committed, name it `*.env.example` and fill it with placeholder
   values like `pk_test_xxxxx`, `<YOUR_API_KEY>`. Real values stay on
   the developer's machine.

4. **Don't commit handoff memos with operational data.** `docs/memory/`
   is gitignored. Keep session-handoff notes — which often capture real
   webhook IDs, server IPs, or third-party resource IDs — out of git.

5. **Treat CLI/log output blocks as production secrets.** Output pasted
   into a blog post or plan often contains a real IP, VM ID, generated
   admin password, or seeded access token. Mask them before committing.

6. **Test fixtures must not look real.** Use obviously-fake values
   (`test-key-1234`, `user@example.test`, `192.0.2.1`). Never copy a
   real response body — even from a sandbox account — into a fixture.

## How we enforce this

* **`gitleaks` runs on every PR** via GitHub Actions
  (`.github/workflows/gitleaks.yml`). PRs with detected secrets are
  blocked from merge.
* **`.gitignore` blocks the obvious patterns**: `.env`, `.env.*`,
  `*.pem`, `*.key`, `id_rsa*`, `*credentials*`, `docs/memory/`. If you
  need an exception, get it reviewed.
* **Reviewers should grep PRs for IPs, hostnames, and known token
  prefixes** (`sk_`, `pk_`, `whsec_`, `hf_`, `Bearer `).

## If you accidentally commit a secret

1. **Treat it as already public** — assume someone has cloned it within
   minutes. Rotate it (revoke + reissue) at the source service before
   doing anything else.
2. After rotating, remove the value from `HEAD` in a follow-up commit.
3. To purge it from git history (so subsequent clones don't carry it),
   use `git filter-repo` and force-push, then notify other contributors
   so they re-clone. Do this only after rotation — purging history is
   not a substitute for revoking the secret.

## Questions

If you are unsure whether a value is safe to commit, ask in the PR before
merging. The cost of a quick check is much smaller than the cost of an
incident.
