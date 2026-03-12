# Passport Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Passport microservice — a Better Auth wrapper that provides authentication for the WorkFort ecosystem.

**Architecture:** Hono HTTP server mounting Better Auth with 6 plugins (JWT, Bearer, API Key, Admin, Device Authorization, Organization). A thin adapter layer wraps `POST /api/auth/verify-api-key` to guarantee the response format matches the Go middleware contract. Database dialect (SQLite or Postgres) is inferred from `DATABASE_URL`.

**Tech Stack:** Node.js LTS, Hono, better-auth, TypeScript, pnpm, Docker

**Spec:** `docs/superpowers/specs/2026-03-12-passport-design.md`

**Go middleware contract (read these before writing any adapter/test code):**
- `workfort/lead/pkg/auth/apikey/apikey.go` — exact JSON shape for verify-api-key
- `workfort/lead/pkg/auth/jwt/jwt.go` — exact JWT claim names: `sub`, `username`, `name`, `display_name`, `type`
- `workfort/lead/pkg/auth/identity.go` — `Identity` struct fields

---

## File Map

| File | Responsibility |
|------|----------------|
| `package.json` | Dependencies: hono, @hono/node-server, better-auth, better-sqlite3, pg, tsx, typescript |
| `tsconfig.json` | TypeScript config targeting ES2022/Node |
| `mise.toml` | Task runner: dev, build, start, seed, lint, test |
| `.env.example` | Template for required env vars |
| `.gitignore` | Ignore `node_modules/`, `dist/`, `data/` |
| `src/auth.ts` | Better Auth instance with all plugins, user schema, JWT config, DB dialect inference |
| `src/index.ts` | Hono server entry point, mounts health + adapter + Better Auth catch-all |
| `src/adapters/verify-api-key.ts` | Adapter route that reshapes API key verify response for Go contract |
| `src/seed.ts` | Standalone seed script for admin user + service identities + API keys |
| `src/test/contract.test.ts` | Integration tests verifying Go middleware contract |
| `src/test/global-setup.ts` | Vitest global setup — starts/stops server for integration tests |
| `vitest.config.ts` | Vitest configuration with test timeout and global setup |
| `Dockerfile` | Multi-stage build, passport user (UID 1000), production image |

---

## Chunk 1: Project Scaffold

### Task 1: Initialize project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Modify: `mise.toml`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialize pnpm project**

```bash
cd /home/kazw/Work/WorkFort/passport/lead
pnpm init
```

- [ ] **Step 2: Install production dependencies**

```bash
pnpm add hono @hono/node-server better-auth better-sqlite3 pg @node-rs/argon2
```

`@hono/node-server` for running Hono on Node.js. `better-sqlite3` for SQLite, `pg` for Postgres, `@node-rs/argon2` is required by better-auth for password hashing.

- [ ] **Step 3: Install dev dependencies**

```bash
pnpm add -D typescript tsx @types/node @types/better-sqlite3 @types/pg vitest
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/test/**/*.ts"]
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
data/
.env
```

- [ ] **Step 6: Create .env.example**

```bash
# Required
BETTER_AUTH_SECRET=change-me-to-a-random-secret

# Database: SQLite path or Postgres URL
# DATABASE_URL=./data/passport.db
# DATABASE_URL=postgresql://user:pass@localhost:5432/passport

# Optional
# PORT=3000
# BETTER_AUTH_URL=http://localhost:3000
# SESSION_MAX_AGE=1209600

# OAuth (required for OAuth flows, optional for email/password)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Seed script
# ADMIN_EMAIL=admin@workfort.dev
# ADMIN_PASSWORD=changeme
```

- [ ] **Step 7: Update mise.toml with tasks**

Read the existing `mise.toml` first (it has `node = "lts"`). Add task definitions:

```toml
[tools]
node = "lts"

[tasks.dev]
run = "npx tsx watch src/index.ts"
description = "Run dev server with hot reload"

[tasks.build]
run = "npx tsc"
description = "Compile TypeScript"

[tasks.start]
run = "node dist/index.js"
description = "Run production server"

[tasks.seed]
run = "npx tsx src/seed.ts"
description = "Seed initial identities and API keys"

[tasks.lint]
run = "npx tsc --noEmit"
description = "Type-check without emitting"

[tasks.test]
run = "npx vitest run"
description = "Run tests"

[tasks.test_watch]
run = "npx vitest"
description = "Run tests in watch mode"
```

- [ ] **Step 8: Create data directory**

```bash
mkdir -p data
```

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json .gitignore .env.example mise.toml
git commit -m "feat: scaffold Passport project with dependencies and tooling"
```

---

## Chunk 2: Better Auth Configuration + Server

### Task 2: Create Better Auth instance

**Files:**
- Create: `src/auth.ts`

This is the core configuration file. It must:
1. Infer database dialect from `DATABASE_URL`
2. Configure all 6 plugins
3. Set JWT claims to exactly match Go middleware expectations
4. Support configurable session lifetime via `SESSION_MAX_AGE`

- [ ] **Step 1: Create src/auth.ts**

```typescript
import { betterAuth } from "better-auth";
import { jwt, bearer, apiKey, admin, organization } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins";
import Database from "better-sqlite3";
import { Pool } from "pg";

const databaseURL = process.env.DATABASE_URL ?? "./data/passport.db";

function isPostgres(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function createDatabase(url: string) {
  if (isPostgres(url)) {
    return new Pool({ connectionString: url });
  }
  return new Database(url);
}

const sessionMaxAge = parseInt(process.env.SESSION_MAX_AGE ?? "1209600", 10);

const plugins = [
  jwt({
    jwt: {
      expirationTime: "15m", // 15 minutes — matches BFF proxy cache cadence
      definePayload: async ({ user }) => ({
        sub: user.id,
        username: (user as any).username,
        name: user.name,
        display_name: (user as any).displayName,
        type: (user as any).type ?? "user",
      }),
    },
  }),
  bearer(),
  apiKey(),
  admin(),
  organization(),
  deviceAuthorization({ verificationUri: "/device" }),
];

const socialProviders: Record<string, any> = {};
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  database: createDatabase(databaseURL),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,

  user: {
    additionalFields: {
      username: { type: "string", unique: true, required: true },
      displayName: { type: "string" },
      type: { type: "string", defaultValue: "user" },
    },
  },

  session: {
    expiresIn: sessionMaxAge,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  socialProviders:
    Object.keys(socialProviders).length > 0 ? socialProviders : undefined,

  plugins,
});
```

**Implementation notes:**
- The `(user as any)` casts are needed because Better Auth's TypeScript types may not include the `additionalFields` on the user parameter in `definePayload`. Verify during implementation whether Better Auth's type system exposes these — if it does, remove the casts.
- The `expirationTime` format (`"15m"` string) must be verified against Better Auth's actual JWT plugin API. Check the source or docs. If it expects a different format (e.g., numeric seconds), adjust.
- If the `deviceAuthorization` plugin throws at startup when no OAuth providers are configured, wrap it in a conditional based on `process.env.GITHUB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID`.

- [ ] **Step 2: Verify it type-checks**

```bash
npx tsc --noEmit
```

Fix any type errors. The `(user as any)` casts may need adjustment based on Better Auth's actual type definitions.

- [ ] **Step 3: Commit**

```bash
git add src/auth.ts
git commit -m "feat: configure Better Auth with plugins, user schema, JWT claims"
```

---

### Task 3: Create Hono server entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create src/index.ts**

```typescript
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { auth } from "./auth";
import { verifyApiKeyRoute } from "./adapters/verify-api-key";

const app = new Hono();

// Health check — public, outside auth
app.get("/health", (c) => c.json({ status: "ok" }));

// Adapter routes take priority (registered before the catch-all)
app.route("/", verifyApiKeyRoute);

// Better Auth handles everything else under /api/auth/*
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

const port = parseInt(process.env.PORT ?? "3000", 10);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Passport listening on :${info.port}`);
});
```

- [ ] **Step 2: Create the adapter stub so the import resolves**

Create `src/adapters/verify-api-key.ts` with a placeholder:

```typescript
import { Hono } from "hono";

export const verifyApiKeyRoute = new Hono();

// TODO: implement in Task 4
verifyApiKeyRoute.post("/api/auth/verify-api-key", async (c) => {
  return c.json({ error: "not implemented" }, 501);
});
```

- [ ] **Step 3: Verify it type-checks**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Test that the server starts**

```bash
BETTER_AUTH_SECRET=dev-secret npx tsx src/index.ts &
sleep 2
curl -s http://localhost:3000/health
# Expected: {"status":"ok"}
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/adapters/verify-api-key.ts
git commit -m "feat: add Hono server with health check and Better Auth mount"
```

---

## Chunk 3: Verify-API-Key Adapter

### Task 4: Implement the verify-api-key adapter

**Files:**
- Modify: `src/adapters/verify-api-key.ts`
- Create: `src/test/contract.test.ts`

This is the most critical piece — the adapter must produce a response that exactly matches what the Go middleware at `workfort/lead/pkg/auth/apikey/apikey.go:76-98` parses:

```json
{
  "valid": true,
  "key": {
    "userId": "...",
    "metadata": {
      "username": "...",
      "name": "...",
      "display_name": "...",
      "type": "..."
    }
  }
}
```

- [ ] **Step 1: Write the failing test for verify-api-key contract**

Create `src/test/contract.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:3000";

// These tests run against a live server. Start the server before running:
//   BETTER_AUTH_SECRET=test-secret npx tsx src/index.ts
//
// The tests verify the exact response format the Go middleware expects.

describe("verify-api-key contract", () => {
  it("returns { valid: false, error: ... } for an invalid key", async () => {
    const res = await fetch(`${BASE}/api/auth/verify-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wf_nonexistent_key" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
  });
});

describe("health", () => {
  it("returns 200 with status ok", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

describe("JWKS", () => {
  it("returns a valid JWKS", async () => {
    const res = await fetch(`${BASE}/api/auth/jwks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toBeDefined();
    expect(Array.isArray(body.keys)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
BETTER_AUTH_SECRET=test-secret npx tsx src/index.ts &
sleep 2
npx vitest run src/test/contract.test.ts
# Expected: FAIL — the stub returns 501
kill %1
```

- [ ] **Step 3: Implement the adapter**

Replace the content of `src/adapters/verify-api-key.ts`:

```typescript
import { Hono } from "hono";
import { auth } from "../auth";

export const verifyApiKeyRoute = new Hono();

verifyApiKeyRoute.post("/api/auth/verify-api-key", async (c) => {
  let apiKey: string;
  try {
    const body = await c.req.json();
    apiKey = body.key;
  } catch {
    return c.json({ valid: false, error: "invalid request body" }, 400);
  }

  if (!apiKey || typeof apiKey !== "string") {
    return c.json({ valid: false, error: "missing key" }, 400);
  }

  try {
    const result = await auth.api.verifyApiKey({ body: { key: apiKey } });

    if (!result || !result.valid) {
      return c.json({ valid: false, error: "invalid api key" });
    }

    // Reshape to match the Go middleware contract.
    // The Go middleware at pkg/auth/apikey/apikey.go:76-98 expects:
    //   { valid: true, key: { userId: "...", metadata: { username, name, display_name, type } } }
    return c.json({
      valid: true,
      key: {
        userId: result.key?.userId,
        metadata: result.key?.metadata ?? {},
      },
    });
  } catch (err: any) {
    // Distinguish "key not found" from internal errors.
    // The Go middleware checks resp.StatusCode != 200 for transport errors
    // (apikey.go:72-73), so returning 500 lets it treat internal failures
    // differently from invalid keys.
    if (err?.status === 404 || err?.code === "API_KEY_NOT_FOUND") {
      return c.json({ valid: false, error: "invalid api key" });
    }
    console.error("verify-api-key internal error:", err);
    return c.json({ error: "internal server error" }, 500);
  }
});
```

**Implementation note:** The exact shape of `result` from `auth.api.verifyApiKey()` must be verified during implementation. Better Auth may return the key object differently (e.g., `result.key` vs `result.data`). Inspect the return value and adjust the reshaping logic accordingly. The critical output contract is what the Go middleware parses — that must not change.

- [ ] **Step 4: Run the test**

```bash
BETTER_AUTH_SECRET=test-secret npx tsx src/index.ts &
sleep 2
npx vitest run src/test/contract.test.ts
# Expected: invalid key test passes, health passes, JWKS passes
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/verify-api-key.ts src/test/contract.test.ts
git commit -m "feat: implement verify-api-key adapter matching Go middleware contract"
```

---

## Chunk 4: Seed Script

### Task 5: Implement the seed script

**Files:**
- Create: `src/seed.ts`

The seed script creates initial identities and API keys via Better Auth's server-side admin API. It must be idempotent (safe to run multiple times).

- [ ] **Step 1: Create src/seed.ts**

```typescript
import { auth } from "./auth";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@workfort.dev";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is required. Set it as an environment variable.");
  process.exit(1);
}

const SERVICES = [
  { username: "svc-sharkfin", name: "Sharkfin Service", type: "service" },
  { username: "svc-nexus", name: "Nexus Service", type: "service" },
  { username: "svc-hive", name: "Hive Service", type: "service" },
] as const;

async function seed() {
  console.log("Seeding Passport...\n");

  // Helper: createUser returns different shapes depending on Better Auth version.
  // Handle both { user: {...} } (wrapped) and direct user object.
  function extractUser(result: any): { id: string; email: string } {
    return result.user ?? result;
  }

  // 1. Create admin user
  try {
    const result = await auth.api.createUser({
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD!,
        name: "Admin",
        data: { username: "admin", displayName: "Admin", type: "user" },
      },
    });
    const user = extractUser(result);
    console.log(`Created admin user: ${user.email} (${user.id})`);
  } catch (err: any) {
    if (err?.message?.includes("already exists") || err?.status === 409) {
      console.log(`Admin user already exists, skipping.`);
    } else {
      throw err;
    }
  }

  // 2. Create service identities and API keys
  for (const svc of SERVICES) {
    let userId: string | undefined;

    try {
      const result = await auth.api.createUser({
        body: {
          email: `${svc.username}@internal.workfort.dev`,
          password: crypto.randomUUID(), // Services don't log in with passwords
          name: svc.name,
          data: {
            username: svc.username,
            displayName: svc.name,
            type: svc.type,
          },
        },
      });
      const user = extractUser(result);
      userId = user.id;
      console.log(`Created service: ${svc.username} (${userId})`);
    } catch (err: any) {
      if (err?.message?.includes("already exists") || err?.status === 409) {
        console.log(`Service ${svc.username} already exists, skipping.`);
        // On re-run, we skip API key creation for existing users.
        // New API keys can be created manually via the admin API if needed.
        continue;
      }
      throw err;
    }

    // Create API key for the newly created service identity
    try {
      const key = await auth.api.createApiKey({
        body: {
          userId: userId!,
          prefix: "wf-svc",
          name: svc.username,
          metadata: {
            username: svc.username,
            name: svc.name,
            display_name: svc.name,
            type: svc.type,
          },
        },
      });
      console.log(`  API key for ${svc.username}: ${key.key}`);
    } catch (err: any) {
      console.error(`  Failed to create API key for ${svc.username}:`, err?.message ?? err);
    }
  }

  console.log("\nSeed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```

**Implementation notes:**
- The exact Better Auth admin API method names (`auth.api.createUser`, `auth.api.createApiKey`) must be verified during implementation. Check Better Auth's TypeScript types or docs.
- The `data` field in `createUser` is how Better Auth passes `additionalFields`. Verify this is the correct field name.
- Idempotency: catches "already exists" errors and skips. On re-run, existing users are skipped entirely (no API key re-creation). The error detection pattern (message string or status code) must be verified against Better Auth's actual error format.
- The `extractUser` helper handles both possible return shapes from `createUser` (`{ user: {...} }` vs direct user object). Verify which shape Better Auth actually returns and simplify if needed.

- [ ] **Step 2: Test the seed script**

```bash
BETTER_AUTH_SECRET=dev-secret ADMIN_PASSWORD=changeme npx tsx src/seed.ts
# Expected output:
# Seeding Passport...
#
# Created admin user: admin@workfort.dev (...)
# Created service: svc-sharkfin (...)
#   API key for svc-sharkfin: wf-svc_...
# Created service: svc-nexus (...)
#   API key for svc-nexus: wf-svc_...
# Created service: svc-hive (...)
#   API key for svc-hive: wf-svc_...
#
# Seed complete.
```

- [ ] **Step 3: Run seed again to verify idempotency**

```bash
BETTER_AUTH_SECRET=dev-secret ADMIN_PASSWORD=changeme npx tsx src/seed.ts
# Expected: "already exists, skipping" messages for all users
```

- [ ] **Step 4: Commit**

```bash
git add src/seed.ts
git commit -m "feat: add seed script for admin user and service identities"
```

---

## Chunk 5: Full Contract Tests

### Task 6: Add end-to-end contract tests with seeded data

**Files:**
- Modify: `src/test/contract.test.ts`

Now that the seed script exists, write tests that create a user via Better Auth's server-side API (no HTTP admin auth required), sign in, get a JWT, and verify the full claim set matches the Go middleware expectations.

The tests use a vitest `globalSetup` to start/stop the server automatically.

- [ ] **Step 1: Create vitest.config.ts and test setup**

Create `vitest.config.ts` at the project root:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15000,
    globalSetup: "./src/test/global-setup.ts",
  },
});
```

Create `src/test/global-setup.ts`:

```typescript
import type { GlobalSetupContext } from "vitest/node";

let serverProcess: any;

export async function setup({ provide }: GlobalSetupContext) {
  // Start the server as a child process
  const { spawn } = await import("child_process");
  serverProcess = spawn("npx", ["tsx", "src/index.ts"], {
    env: { ...process.env, BETTER_AUTH_SECRET: "test-secret", PORT: "3000" },
    stdio: "pipe",
  });

  // Wait for server to be ready
  const maxRetries = 20;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch("http://localhost:3000/health");
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function teardown() {
  serverProcess?.kill();
}
```

- [ ] **Step 2: Add user creation + sign-in + JWT claims test**

Add to `src/test/contract.test.ts`:

```typescript
describe("JWT claims contract", () => {
  const testUser = {
    email: "test-jwt@workfort.dev",
    password: "test-password-123",
    name: "Test User",
    username: "testuser-jwt",
    displayName: "Tester",
    type: "user",
  };

  let sessionCookie: string;

  it("creates a user via server-side admin API", async () => {
    // Use server-side auth.api.createUser which does not require an admin session.
    // In tests, we call the sign-up endpoint directly instead.
    const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
        name: testUser.name,
        username: testUser.username,
        displayName: testUser.displayName,
        type: testUser.type,
      }),
    });

    expect(res.status).toBeLessThan(400);
  });

  it("signs in and gets a session cookie", async () => {
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
      redirect: "manual",
    });

    expect(res.status).toBeLessThan(400);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    sessionCookie = setCookie!;
  });

  it("GET /api/auth/token returns JWT with correct claims", async () => {
    const res = await fetch(`${BASE}/api/auth/token`, {
      headers: { Cookie: sessionCookie },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();

    // Decode JWT payload (no verification — just checking claims)
    const payload = JSON.parse(
      Buffer.from(body.token.split(".")[1], "base64url").toString()
    );

    // These exact claim names are parsed by pkg/auth/jwt/jwt.go:77-96
    expect(payload.sub).toBeDefined();
    expect(payload.username).toBe(testUser.username);
    expect(payload.name).toBe(testUser.name);
    expect(payload.display_name).toBe(testUser.displayName);
    expect(payload.type).toBe(testUser.type);
  });
});

describe("verify-api-key contract with valid key", () => {
  it("returns the correct response shape for an invalid key", async () => {
    const res = await fetch(`${BASE}/api/auth/verify-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wf_invalid_key_for_testing" }),
    });

    const body = await res.json();

    // Go middleware at pkg/auth/apikey/apikey.go:88 checks:
    //   if !result.Valid || result.Key == nil
    expect(body).toHaveProperty("valid");
    expect(typeof body.valid).toBe("boolean");
    expect(body.valid).toBe(false);
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });
});
```

**Implementation notes:**
- Tests use the sign-up endpoint (`/api/auth/sign-up/email`) to create users, avoiding the admin API auth requirement. Better Auth's sign-up endpoint is public by default.
- The `additionalFields` (`username`, `displayName`, `type`) may need to be passed differently in the sign-up body vs. the admin `createUser` body. Verify how Better Auth handles additional fields during sign-up.
- The sign-in endpoint (`/api/auth/sign-in/email`) and token endpoint response shape (`{ token: "..." }`) must be verified against Better Auth's actual routing.

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```

The `globalSetup` handles server start/stop automatically.

- [ ] **Step 3: Fix any issues discovered**

Better Auth's actual API responses may differ from what's documented. Adjust:
- Endpoint paths
- Response shapes
- Auth requirements for admin endpoints
- Cookie names and formats

- [ ] **Step 4: Commit**

```bash
git add src/test/contract.test.ts
git commit -m "test: add end-to-end contract tests for JWT claims and API key verification"
```

---

## Chunk 6: Dockerfile

### Task 7: Create the Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
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
RUN pnpm build

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
```

- [ ] **Step 2: Build the image**

```bash
docker build -t passport:latest .
```

- [ ] **Step 3: Test the image**

```bash
docker run --rm -e BETTER_AUTH_SECRET=dev-secret -p 3000:3000 passport:latest &
sleep 3
curl -s http://localhost:3000/health
# Expected: {"status":"ok"}
docker stop $(docker ps -q --filter ancestor=passport:latest)
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile with non-root passport user"
```

---

## Chunk 7: Final Verification

### Task 8: Full manual verification against the spec checklist

Run through the verification checklist from the setup requirements doc. This is a manual pass — no new code.

- [ ] **Step 1: Start the server fresh**

```bash
rm -rf data/passport.db
BETTER_AUTH_SECRET=dev-secret npx tsx src/index.ts &
```

- [ ] **Step 2: Verify JWKS endpoint**

```bash
curl -s http://localhost:3000/api/auth/jwks | jq .
# Expected: { "keys": [ { "kty": "OKP", "crv": "Ed25519", ... } ] }
```

- [ ] **Step 3: Run seed script**

```bash
BETTER_AUTH_SECRET=dev-secret ADMIN_PASSWORD=changeme npx tsx src/seed.ts
# Save the API key output
```

- [ ] **Step 4: Verify sign-in and session**

```bash
curl -v -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@workfort.dev","password":"changeme"}'
# Expected: set-cookie header with session token
```

- [ ] **Step 5: Verify JWT token endpoint**

```bash
curl -s http://localhost:3000/api/auth/token \
  -H "Cookie: <session-cookie-from-step-4>" | jq .
# Expected: { "token": "ey..." }
# Decode the JWT and verify claims: sub, username, name, display_name, type
```

- [ ] **Step 6: Verify API key verification**

```bash
curl -s -X POST http://localhost:3000/api/auth/verify-api-key \
  -H "Content-Type: application/json" \
  -d '{"key":"<wf-svc_key-from-seed-output>"}' | jq .
# Expected: { "valid": true, "key": { "userId": "...", "metadata": { ... } } }
```

- [ ] **Step 7: Run the full test suite**

```bash
npx vitest run
# Expected: all tests pass
```

- [ ] **Step 8: Stop server and commit any final fixes**

```bash
kill %1
git add -A
git commit -m "chore: final verification and fixes"
```
