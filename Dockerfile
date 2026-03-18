# SPDX-License-Identifier: Apache-2.0

FROM node:lts-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install production dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/auth/package.json ./packages/auth/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile --prod

# Build TypeScript (server)
FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/auth/package.json ./packages/auth/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

# Build admin UI (React MF remote)
FROM base AS build-web
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/auth/package.json ./packages/auth/
COPY web/ ./web/
RUN pnpm install --frozen-lockfile
RUN cd web && pnpm build

# Production image
FROM node:lts-slim AS runtime
WORKDIR /app

RUN mkdir -p /app/data && chown 1000:1000 /app/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build-web /app/web/dist ./web/dist
COPY package.json ./

USER 1000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
