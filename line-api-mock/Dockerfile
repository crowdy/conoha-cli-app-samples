# syntax=docker/dockerfile:1.7

# ─── Stage 1: install prod-only dependencies in an isolated layer ──────────
# Keeping `npm install` in its own stage prevents the dev-side caches and
# scratch files from bleeding into the runtime image.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

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
# `PORT` defaults to 3000 here so EXPOSE / HEALTHCHECK / the app all agree.
# Override at run time (`docker run -e PORT=8080 -p 8080:8080 ...`) and the
# HEALTHCHECK below picks it up via shell expansion.
ENV PORT=3000
EXPOSE 3000

# Run as the unprivileged `node` user shipped in the official image.
USER node

# Container-level healthcheck against the app's /health route. compose.yml
# also declares this so docker can mark the service unhealthy if the app
# crashes or hangs. Shell form so `${PORT}` is resolved at probe time.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT:-3000}/health" >/dev/null 2>&1 || exit 1

CMD ["npx", "tsx", "src/index.ts"]
