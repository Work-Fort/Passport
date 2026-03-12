# Passport — Design Spec

Passport is a Better Auth microservice providing authentication for the WorkFort ecosystem. It is the single source of truth for all identity (users, agents, services). Go services validate callers via shared middleware (`pkg/auth/`) that verifies JWTs and API keys against Passport's endpoints.

**Reference:** `workfort/lead/docs/2026-03-11-service-auth-design.md` (full design rationale), `workfort/lead/docs/2026-03-11-better-auth-setup.md` (setup requirements).

---

## Stack

| Component | Choice |
|-----------|--------|
| Runtime | Node.js LTS (via mise) |
| Framework | Hono |
| Auth library | better-auth |
| Storage | SQLite |
| Package manager | pnpm |
| TypeScript build | `tsc` (production), `tsx` (development) |
| Deployment | Docker image → Nexus VM |

---

## Architecture: Approach B (Adapter Layer)

Better Auth handles core authentication. A thin Hono adapter layer wraps specific endpoints where the response format must match an exact contract consumed by the Go middleware. Currently this is only `POST /api/auth/verify-api-key`.

**Why not pure passthrough (Approach A)?** The Go middleware at `pkg/auth/apikey/apikey.go` parses exact JSON field names from the verify response. If Better Auth's response shape differs or changes in a future version, every Go service breaks. The adapter absorbs the difference.

**Why not fully custom endpoints (Approach C)?** Defeats the "thin wrapper" goal. Most endpoints (JWKS, token, session, OAuth flows) work out of the box.

---

## Project Structure

```
passport/lead/
├── src/
│   ├── index.ts              # Hono server, mounts auth + adapters
│   ├── auth.ts               # Better Auth instance configuration
│   ├── adapters/
│   │   └── verify-api-key.ts # Reshapes verify response for Go contract
│   └── seed.ts               # Standalone seed script
├── package.json
├── tsconfig.json
├── mise.toml                 # Tasks: dev, build, start, seed, lint
├── Dockerfile
├── .env.example
└── data/                     # SQLite database (gitignored)
```

---

## Configuration

All configuration via environment variables:

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | HTTP listen port |
| `DATABASE_URL` | `./data/passport.db` | No | SQLite database path |
| `BETTER_AUTH_SECRET` | — | Yes | Session signing key |
| `BETTER_AUTH_URL` | `http://localhost:3000` | No | Base URL for auth service |
| `SESSION_MAX_AGE` | `1209600` (14 days) | No | Session lifetime in seconds |
| `GITHUB_CLIENT_ID` | — | No* | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | — | No* | GitHub OAuth client secret |
| `GOOGLE_CLIENT_ID` | — | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | No | Google OAuth client secret |
| `ADMIN_EMAIL` | `admin@workfort.dev` | No | Initial admin user email (seed script) |
| `ADMIN_PASSWORD` | — | Yes (seed) | Initial admin user password (seed script) |

\* Required for OAuth flows. Service can start without them (email/password auth still works).

---

## Better Auth Configuration

### Plugins

| Plugin | Purpose |
|--------|---------|
| JWT | Issues JWTs from sessions, exposes `/api/auth/jwks` |
| Bearer | Enables `Authorization: Bearer` header auth |
| API Key | API keys for agents and service-to-service auth |
| Admin | Programmatic identity creation |
| Device Authorization | RFC 8628 device flow for CLI OAuth |
| Organization | Scopes API keys to teams/orgs |

### User Schema Extension

```typescript
user: {
  additionalFields: {
    username:    { type: "string", unique: true, required: true },
    displayName: { type: "string" },
    type:        { type: "string", defaultValue: "user" },
  },
}
```

Three identity types share the same user table: `user`, `agent`, `service`. The `type` field is immutable after creation and defaults to `"user"`.

### JWT Claims

```typescript
jwt({
  jwt: {
    expirationTime: 60 * 15,  // 15 minutes
    definePayload: async ({ user }) => ({
      sub: user.id,
      username: user.username,
      name: user.name,
      display_name: user.displayName,
      type: user.type ?? "user",
    }),
  },
})
```

These exact claim names are parsed by the Go middleware at `pkg/auth/jwt/jwt.go`. Changing them breaks every Go service.

### Session Configuration

- **Lifetime**: configurable via `SESSION_MAX_AGE` env var (default 14 days)
- **Cookie**: `HttpOnly`, `SameSite=Lax`, `Secure` in production (Better Auth defaults)
- **Cookie name**: Better Auth default (`better-auth.session_token`)

---

## Routing

Routes are registered in this order (Hono matches first registration):

| Priority | Path | Handler | Description |
|----------|------|---------|-------------|
| 1 | `GET /health` | Hono | Health check for Docker/VM monitoring |
| 2 | `POST /api/auth/verify-api-key` | Adapter | Reshapes response to match Go contract |
| 3 | `/api/auth/**` | Better Auth | All other auth endpoints (JWKS, token, session, OAuth, admin) |

### Adapter: verify-api-key

The Go middleware sends:

```json
{ "key": "wf_a8f3..." }
```

The adapter calls Better Auth's internal API key verification and returns:

```json
{
  "valid": true,
  "key": {
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "metadata": {
      "username": "kazw",
      "name": "Kaz Walker",
      "display_name": "Kaz",
      "type": "user"
    }
  }
}
```

Failure response:

```json
{
  "valid": false,
  "error": "invalid api key"
}
```

The `metadata` object must contain `username`, `name`, `display_name`, and `type`. This is enforced by convention when creating API keys (seed script and admin API usage).

---

## Endpoints Exposed

These endpoints are consumed by the Go middleware and CLI. They are provided by Better Auth's plugins — the adapter layer only touches `verify-api-key`.

| Endpoint | Method | Plugin | Consumer |
|----------|--------|--------|----------|
| `/api/auth/jwks` | GET | JWT | `pkg/auth/jwt` — fetches public keys for local JWT validation |
| `/api/auth/verify-api-key` | POST | API Key (adapted) | `pkg/auth/apikey` — verifies API keys |
| `/api/auth/token` | GET | JWT + Bearer | BFF proxy — converts session cookie to JWT |
| `/api/auth/session` | GET | Core | Shell checks session on boot, CLI checks auth state |
| `/health` | GET | Custom (Hono) | Docker/VM health monitoring |

---

## Seed Script

A standalone script (`mise run seed`) creates initial identities and API keys via Better Auth's server-side admin API.

**Creates:**

1. **Admin user** — `type: "user"`, `username: "admin"`
2. **Service identities** (one per service):
   - `svc-sharkfin` (`type: "service"`)
   - `svc-nexus` (`type: "service"`)
   - `svc-hive` (`type: "service"`)
3. **API keys** for each service identity with `wf-svc` prefix

**Behavior:**
- Service identities get random passwords (they authenticate via API keys only)
- API key `metadata` includes all four fields the Go middleware needs (`username`, `name`, `display_name`, `type`)
- Keys are printed to stdout — the operator captures them for service configuration
- Idempotent: checks for existing records before creating

### API Key Prefix Convention

| Identity type | Prefix | Example |
|---------------|--------|---------|
| User (personal access token) | `wf_` | `wf_a8f3...` |
| Agent | `wf-agent_` | `wf-agent_b2c1...` |
| Service | `wf-svc_` | `wf-svc_d4e5...` |

---

## Docker & Deployment

### Dockerfile

Multi-stage build:
1. **deps** — install production dependencies with `pnpm install --frozen-lockfile --prod`
2. **build** — install all dependencies, compile TypeScript with `tsc`
3. **runtime** — `node:lts-slim`, copies only `dist/` and production `node_modules`

Exposes port 3000. SQLite data at `/app/data` (Docker volume).

### Deployment Flow

1. Build Docker image locally: `docker build -t passport:latest .`
2. Push/pull via Nexus
3. Deploy as a Nexus VM with:
   - Environment variables for secrets (`BETTER_AUTH_SECRET`, OAuth creds)
   - Persistent volume mounted at `/app/data` for SQLite

### mise.toml Tasks

| Task | Command | Description |
|------|---------|-------------|
| `dev` | `npx tsx watch src/index.ts` | Dev server with hot reload |
| `build` | `npx tsc` | Compile TypeScript |
| `start` | `node dist/index.js` | Run production server |
| `seed` | `npx tsx src/seed.ts` | Seed initial identities |
| `lint` | `npx tsc --noEmit` | Type-check without emitting |

---

## Testing

### Integration Tests

A small test suite that boots the server and verifies the Go contract:

- `GET /api/auth/jwks` returns a valid JSON Web Key Set
- JWT claims contain exactly `sub`, `username`, `name`, `display_name`, `type`
- `POST /api/auth/verify-api-key` response matches the exact Go contract format
- `GET /health` returns 200

### Manual Verification Checklist

Per the setup requirements doc:

- [ ] `GET /api/auth/jwks` returns a JSON Web Key Set
- [ ] Create a user with `username`, `displayName`, and `type` fields
- [ ] Log in, get a session cookie
- [ ] `GET /api/auth/token` (with session cookie) returns a JWT with correct claims
- [ ] Create an API key with metadata containing `username`, `name`, `display_name`, `type`
- [ ] `POST /api/auth/verify-api-key` with the key returns identity with metadata
- [ ] Device authorization flow works (when OAuth providers are configured)

### No unit tests for Better Auth internals

We are wrapping a library, not reimplementing it. Tests focus on the contract surface: "does the response match what the Go middleware expects?"

---

## Out of Scope (Initial Build)

- **One-time token flow** (CLI → browser session handoff) — deferred until CLI BFF proxy is built
- **Authorization** — each service handles its own permissions; Passport only does authentication
- **BFF proxy logic** — lives in the CLI, not Passport
- **`@workfort/ui` auth module** — frontend wrapper that calls `/api/auth/session`
- **OAuth 2.1 Client Credentials** — future addition when Substrate arrives

---

## Port Assignment

Passport runs on `127.0.0.1:3000` — this is hardcoded in every consuming Go service's Viper defaults (`auth` key in `cmd/root.go`).
