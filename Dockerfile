FROM node:lts-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install production dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Build TypeScript
FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

# Production image
FROM node:lts-slim AS runtime
WORKDIR /app

RUN mkdir -p /app/data && chown node:node /app/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
