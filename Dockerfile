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

# Create non-root user (UID/GID 1000)
RUN groupadd -g 1000 passport && useradd -u 1000 -g passport -m passport
RUN mkdir -p /app/data && chown passport:passport /app/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER passport
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
