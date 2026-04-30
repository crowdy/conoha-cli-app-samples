# Self-hosted GitHub Actions runner with claude CLI pre-installed
# for the doc-reviewer Composite Action.

FROM myoung34/github-runner:2.333.1

USER root

# Install dependencies for claude CLI install + jq for action scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        jq \
        bats \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (claude CLI ships as npm package)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Custom entrypoint wraps base entrypoint with auth status check
COPY entrypoint.sh /usr/local/bin/doc-reviewer-entrypoint.sh
RUN chmod +x /usr/local/bin/doc-reviewer-entrypoint.sh

# Ensure runner user owns the volume mount targets. Pre-creating these with
# the right ownership lets a fresh named volume (claude_home, runner_work)
# inherit runner ownership on first mount; otherwise Docker initialises the
# volume root-owned and Runner.Listener fails with "Access to the path ...
# is denied" the first time it tries to write there.
RUN mkdir -p /home/runner/.claude /tmp/runner/work \
    && chown -R runner:runner /home/runner/.claude /tmp/runner

USER runner

ENTRYPOINT ["/usr/local/bin/doc-reviewer-entrypoint.sh"]
# Setting ENTRYPOINT in a derived image resets CMD inherited from the base.
# Re-declare upstream's CMD explicitly so the runner Listener actually starts
# after the entrypoint configures it.
CMD ["./bin/Runner.Listener", "run", "--startuptype", "service"]
