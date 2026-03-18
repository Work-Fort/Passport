# SPDX-License-Identifier: Apache-2.0

FROM oven/bun:latest AS base

# Install production dependencies only (no native modules needed)
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/auth/package.json ./packages/auth/
COPY web/package.json ./web/
RUN bun install --frozen-lockfile --production

# Build admin UI — needs dev deps (vite, etc.) but not better-sqlite3
FROM base AS build-web
WORKDIR /app/web
COPY web/package.json web/tsconfig.json web/vite.config.ts ./
COPY web/index.html ./
COPY web/src/ ./src/
RUN bun install
RUN bun run build

# Production image — Bun runs TypeScript directly, no compilation step
FROM oven/bun:latest AS runtime
WORKDIR /app

RUN mkdir -p /app/data && chown 1000:1000 /app/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build-web /app/web/dist ./web/dist
COPY package.json tsconfig.json ./
COPY src/ ./src/

USER 1000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "run", "src/index.ts"]
