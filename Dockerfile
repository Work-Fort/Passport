# SPDX-License-Identifier: Apache-2.0

FROM oven/bun:latest AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/auth/package.json ./packages/auth/
COPY web/package.json ./web/
RUN bun install --frozen-lockfile

# Build admin UI (React MF remote)
FROM base AS build-web
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY web/ ./web/
RUN cd web && bun run build

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
