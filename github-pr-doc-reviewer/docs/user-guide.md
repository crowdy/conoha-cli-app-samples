# User Guide

## How it works

1. A PR is opened or updated in your spec repo.
2. The workflow `doc-review.yml` triggers on the self-hosted runner.
3. The Composite Action runs in `quick` mode by default.
4. If the PR has the `deep-review` label, it runs `deep` mode instead.

## Quick mode (default)

Runs only mechanical checks:

- TBD/TODO/FIXME markers
- Empty sections (header followed immediately by another header)
- Broken internal links

Posts a single sticky comment on the PR. Updated on every push.

## Deep mode (opt-in)

Add the `deep-review` label to the PR. The workflow re-runs and:

1. Performs all mechanical checks.
2. Builds a context bundle: glossary, ADRs, sibling files in changed domains.
3. Calls Claude (via OAuth subscription) to detect:
   - Term mismatches with the glossary.
   - ADR violations.
   - Code/spec drift between sibling files in the same domain.
   - Inconsistencies between flow / api / data-model / screens.
4. Posts a formal PR review with line-level inline comments.

The sticky comment from quick mode remains; the inline review is additional.

## Customization

Inputs you can override in your workflow:

| Input | Default | Notes |
|---|---|---|
| `mode` | `quick` | `quick` or `deep` |
| `paths` | `**/*.md,**/*.yml,**/*.yaml` | Comma-separated globs |
| `glossary-path` | `glossary.md` | Single source of truth for terminology |
| `adr-path` | `adr` | Directory of ADR files |
| `fail-on-error` | `false` | Set `true` to fail the check when error-severity findings exist |

## Recommended spec-repo layout

```
your-spec-repo/
├── README.md
├── glossary.md
├── adr/0001-...md
├── domains/
│   └── <feature>/{api.yml, flows/*.md, screens/*.md, data-model.md}
└── .github/workflows/doc-review.yml
```

See `examples/specs-fixture/` in this sample for a runnable demo.

## Demo

```bash
# Fork or copy the fixture into your own GitHub repo
cp -r github-pr-doc-reviewer/examples/specs-fixture/. ~/dev/my-fixture/
cd ~/dev/my-fixture
git init && git add . && git commit -m "init"
gh repo create my-fixture --public --source=. --push

# Add the workflow
mkdir -p .github/workflows
cp ~/conoha-cli-app-samples/github-pr-doc-reviewer/workflow-template/doc-review.yml .github/workflows/
git add . && git commit -m "add doc-review workflow" && git push

# Open a PR that touches a doc
git checkout -b try-pr
echo "" >> domains/auth/flows/login.md
git commit -am "tweak login flow"
git push -u origin try-pr
gh pr create --title "Demo" --body "Trying doc-reviewer"
```

The sticky comment should appear within ~30 seconds. Add the `deep-review` label to trigger the AI review.

## Troubleshooting

- **No comment appears** — check runner logs (`docker logs`). Likely causes: runner offline, label `deep-review` not created in the repo, missing `pull-requests: write` permission.
- **"Doc reviewer not configured"** — run `docker exec -it <container> claude` to authenticate.
- **AI response was not valid JSON** — see action logs. Usually transient; retry by pushing a new commit.

## Cost

Quick mode uses no LLM tokens.

Deep mode uses your Anthropic Pro/Max subscription quota. With prompt caching across spec-repo context, expect ~10–50k input tokens + ~1–2k output tokens per PR. Within subscription limits, no per-PR billing.
