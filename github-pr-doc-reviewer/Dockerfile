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

# Ensure runner user owns the .claude directory mount target
RUN mkdir -p /home/runner/.claude && chown -R runner:runner /home/runner/.claude

USER runner

ENTRYPOINT ["/usr/local/bin/doc-reviewer-entrypoint.sh"]
