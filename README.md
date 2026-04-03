# Passport

Identity provider for WorkFort. Handles authentication, session management, API keys, and JWT issuance for all services in the platform.

Built on [Better Auth](https://better-auth.com/) with Hono.

## Features

- Email/password authentication
- JWT issuance for service-to-service communication (EdDSA)
- API key management for service identities
- Admin role-based access control
- Setup mode — first-run onboarding with no existing credentials required
- Service discovery endpoint (`/ui/health`) for WorkFort BFF integration

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [pnpm](https://pnpm.io/)

### Run

```bash
pnpm install
pnpm build
BETTER_AUTH_SECRET=$(openssl rand -base64 32) node dist/index.js
```

Passport listens on `http://0.0.0.0:3000` by default. Database migrations run automatically on startup.

### Seed (first run)

```bash
ADMIN_PASSWORD=<your-password> node dist/seed.js
```

Creates the admin user and service identities (Sharkfin, Nexus, Hive) with API keys. Keys are printed to stdout — capture them securely.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BETTER_AUTH_SECRET` | **Yes** | — | Signing secret for sessions and tokens. Must be at least 32 characters. Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | Recommended | `http://localhost:3000` | Canonical URL. Determines JWT issuer/audience and cookie `Secure` flag. Set to `https://` in production. |
| `DATABASE_URL` | No | `./data/passport.db` | SQLite path or PostgreSQL connection string. |
| `HOST` | No | `0.0.0.0` | Listen address. |
| `PORT` | No | `3000` | Listen port. |
| `ADMIN_PASSWORD` | Seed only | — | Password for the seeded admin account. |

## Security

### Known Deficiencies

**No rate limiting.** Authentication endpoints (`/v1/sign-in/email`, `/v1/sign-up/email`) and the API key verification endpoint (`/v1/verify-api-key`) have no rate limiting. Brute-force attacks against passwords and API keys are not throttled at the application level. Deployments should use an upstream reverse proxy (e.g., nginx, Caddy, cloud load balancer) with rate limiting configured, or a network-level solution, until application-level rate limiting is implemented.

### Security Model

- **Passwords** are hashed with Argon2 (`@node-rs/argon2`).
- **API keys** are stored as SHA-256 hashes. Verification is hash-then-lookup (not timing-vulnerable).
- **Sessions** use `HttpOnly`, `SameSite=Lax` cookies. `Secure` flag is set when `BETTER_AUTH_URL` uses `https://`.
- **JWTs** are signed with EdDSA (Ed25519). Keys are generated on first use and persisted in the database.
- **Sign-up** is open only when no users exist (setup mode). After the first user, sign-up requires admin authentication.
- **Service discovery** (`/ui/health`) is unauthenticated by design — it returns only the service name and label, no sensitive data.

## API

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | None | Health check |
| `/ui/health` | GET | None | Service discovery for WorkFort BFF |
| `/v1/sign-up/email` | POST | None (setup) / Admin | Create account |
| `/v1/sign-in/email` | POST | None | Sign in, returns session cookie |
| `/v1/token` | GET | Session cookie | Exchange session for JWT |
| `/v1/jwks` | GET | None | Public JWKS for JWT verification |
| `/v1/verify-api-key` | POST | None | Verify an API key (for service-to-service auth) |

## Deploy on Nexus

Bootstrap a Passport instance on a [Nexus](https://github.com/Work-Fort/Nexus) host.

### 1. Create a persistent drive

```bash
nexusctl drive create passport-data --size 100M --mount-path /data
```

### 2. Create the VM

```bash
nexusctl vm create passport \
  --image ghcr.io/work-fort/passport:v0.5.2 \
  --restart-policy always
```

### 3. Attach the drive

```bash
nexusctl drive attach passport-data --vm passport
```

### 4. Set environment variables

```bash
nexusctl vm env passport \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  BETTER_AUTH_URL=http://passport.nexus:3000 \
  DATABASE_URL=/data/passport.db \
  TRUSTED_ORIGINS=http://localhost:16100
```

Adjust `TRUSTED_ORIGINS` to include all origins that will make
authenticated requests (comma-separated).

### 5. Start

```bash
nexusctl vm start passport
```

Passport is now available at `http://passport.nexus:3000` (requires
Nexus DNS). The restart policy was set at creation (step 2) so the
VM will auto-start on reboot.

### 6. Seed (optional)

To create the admin user and service API keys non-interactively:

```bash
nexusctl vm exec passport -- \
  sh -c 'ADMIN_EMAIL=admin@workfort.dev ADMIN_PASSWORD=<password> bun run src/seed.ts'
```

API keys for Sharkfin, Nexus, and Hive are printed to stdout —
capture them securely.

### Upgrading

```bash
nexusctl vm stop passport
nexusctl vm update-image passport ghcr.io/work-fort/passport:v0.6.0
nexusctl vm start passport
```

The drive at `/data` is preserved across image updates.

## License

[Apache-2.0](LICENSE.md)
