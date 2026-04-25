# syntax=docker/dockerfile:1.7

# ─── Stage 1: install prod-only dependencies in an isolated layer ──────────
# Keeping `npm install` in its own stage prevents the dev-side caches and
# scratch files from bleeding into the runtime image.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ─── Stage 2: minimal runtime image ───────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# wget is in busybox on alpine, used by HEALTHCHECK.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY specs ./specs

ENV NODE_ENV=production
EXPOSE 3000

# Run as the unprivileged `node` user shipped in the official image.
USER node

# Container-level healthcheck against the app's /health route. compose.yml
# also declares this so docker can mark the service unhealthy if the app
# crashes or hangs.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

CMD ["npx", "tsx", "src/index.ts"]
