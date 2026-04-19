# Remaining Work — Passport

Tracks remaining work for the Passport (auth provider) project. Items are roughly priority-ordered within each section.

This file reconciles the 2026-03-17 cross-repo security audit
(`docs/2026-03-17-security-audit.md`) and adds findings discovered since.
Each entry references the audit item number where applicable.

---

## Open

### Bugs

- [ ] **High — No rate limiting on auth endpoints** (Audit #8).
  `/v1/sign-in/email`, `/v1/sign-up/email`, and `/v1/verify-api-key` have no
  application-level rate limiting. Documented as a known deficiency in
  `README.md` ("Security → Known Deficiencies"); deployment-time mitigation is
  expected to come from an upstream reverse proxy. Consumer-side caching in
  the Go `apikey` validator (30s default TTL,
  `go/service-auth/apikey/apikey.go:39-46`) reduces verify load but does not
  bound brute-force throughput from a hostile client. Note that
  `auth.ts:52` explicitly disables Better Auth's per-key rate limiter
  (commit `94ed35c`) — internal-services rationale; an external-facing
  deployment would need to re-enable per-key limits and add per-IP limits.

- [ ] **Medium — Default `BETTER_AUTH_URL` is `http://`** (Audit #17).
  `auth.ts:78` falls back to `http://localhost:3000` if the env var is unset.
  Better Auth derives the cookie `Secure` flag from the URL scheme, so an
  operator who forgets to set `BETTER_AUTH_URL` in production silently ships
  cookies without `Secure`. README documents the recommendation but the
  default is unchanged. Fix direction: in production mode (e.g.,
  `NODE_ENV=production` or any non-localhost host), refuse to start when
  `BETTER_AUTH_URL` is unset or starts with `http://`.

- [ ] **Medium — Seed prints API keys to stdout in plaintext** (Audit #18).
  `seed.ts:96` logs `key.key` (the bearer string) to stdout for each seeded
  service identity. This is the *only* moment the plaintext is available
  (Better Auth stores SHA-256 hashes), so some surface is unavoidable, but
  stdout is the wrong sink: it lands in container logs, CI artefacts, and
  shell history. Fix direction: write to a file with `0600` perms, prompt
  the operator to read-and-delete; or require `--print-keys` to opt in.

- [ ] **Low — Static weak test secrets in source control** (Audit #19).
  `src/test/global-setup.ts:34-36` hardcodes `BETTER_AUTH_SECRET=test-secret`
  and `ADMIN_PASSWORD=test-admin-pass`. Test-only and deleted with the test
  DB on each run, but mirrors a real-world anti-pattern where copy-paste
  during a refactor lands these in a non-test file. Fix direction: generate
  per-run random values in `setup()` and pass through env to seed + server.

---

## Test Coverage Gaps

### Convention: every `t.Skip` / `it.skip` / `describe.skip` must be cross-referenced here

Any conditional skip in a unit, integration, or contract test MUST have a
corresponding entry in this section. The entry must name the test, state the
condition under which it skips, and describe the work needed to remove the
skip. A skip with no paper trail is indistinguishable from an accidental
omission and will be treated as one during future audits. Convention
mirrored from sharkfin's `docs/remaining-work.md`.

### Current state

No skipped tests found in either the TypeScript suite (`src/test/`) or the
Go suite (`go/service-auth/...`). Convention is recorded preemptively so
that any future skip is documented at introduction.

---

## Consumer notes

Cross-repo invariants every Passport consumer must know about. These are
documented behaviours, not bugs.

- **30s API-key cache TTL.** The Go `apikey` validator
  (`go/service-auth/apikey/apikey.go:39-46`) caches verification results
  for 30 seconds by default. A revoked key remains valid in every
  consumer for up to that window. Surface this in any product flow that
  depends on immediate revocation.
- **Better Auth `apiKey` rate limiter is disabled.** `auth.ts:52` explicitly
  disables Better Auth's per-key brute-force limiter (commit `94ed35c`,
  internal-services rationale). Per-key rate limiting must come from the
  deploy layer (reverse proxy) until application-level rate limiting (see
  Planned section) lands. Consumers assuming Better Auth defaults are
  wrong.

---

## Recently Completed

### Auth scheme dispatch (2026-04-19)

- [x] **Cluster 3b — validator fallthrough.** Resolved by splitting JWT
  and API-key auth into explicit `Authorization` schemes
  (`Bearer` / `ApiKey-v1`). `service-auth/middleware.go` now dispatches
  by scheme with no fallthrough; a malformed JWT can no longer leak to
  `/v1/verify-api-key`. Regression-prevention test:
  `TestMiddleware_MalformedJWTDoesNotFallThrough`. Cross-repo consumer
  migration tracked in `~/Work/WorkFort/AGENT-POOL-REMAINING-WORK.md`
  § "Passport auth scheme split (2026-04-19, in flight)".

### Security fixes (since 2026-03-17 audit)

- [x] **#3 (Critical) — `BETTER_AUTH_SECRET` startup validation.**
  Fixed in commit `d6065a5` ("security: require BETTER_AUTH_SECRET at
  startup"). `src/index.ts:8-12` now exits with a clear error when the
  secret is unset.
- [x] **#4 (Critical) — Sign-up admin role check.**
  Fixed in commit `703fef1` ("security: sign-up guard checks admin role,
  not just any session"). `src/app.ts:80-88` now requires
  `session.user.role === "admin"` once any user exists.
- [x] **#9 (High) — Raw error logging in verify-api-key.**
  Fixed in commit `3f44a2e` ("security: sanitize error logging in
  verify-api-key"). `src/adapters/verify-api-key.ts:76` now logs only
  `err.message` (or `String(err)`), not the raw object.
- [x] **#16 (Medium) — Sign-up guard fall-through on DB error.**
  Fixed in commit `23c1882` ("security: sign-up guard returns 503 on DB
  error instead of falling through"). `src/app.ts:71-78` now wraps the
  user-existence query in try/catch and returns 503.

### Audit items not in scope of this resolution

- **#7 (High) — Unauthenticated `/v1/verify-api-key` endpoint, brute-forceable.**
  Status: design-as-intended, mitigated by deploy-time rate limiting.
  `src/adapters/verify-api-key.ts:32` is unauthenticated by necessity:
  service-side validators in other repos call this without a session, and
  the Go `apikey.Validator` (`go/service-auth/apikey/apikey.go`) uses it as
  its sole verification path. The exposure is acknowledged in the README
  alongside #8 and is bounded by the same upstream rate-limiting
  recommendation. Tracked here for visibility rather than as an open bug;
  closure of #8 closes the practical surface.

### Onboarding (Plan 11, Passport-side)

- [x] `setup_mode` flag in `/ui/health` — `src/app.ts:16-44`
- [x] First user auto-promoted to admin — `src/app.ts:95-111`
- [x] Migrations run on startup — `src/index.ts:15-16`
- [x] `TRUSTED_ORIGINS` env var for BFF cross-origin requests — commit
  `2e6fb6d`

### Admin UI (commits `9dfb25f`, `17aa503`, `19476a7`)

- [x] React admin UI with users, service keys, agent keys
- [x] Last-admin guard (cannot remove or demote final admin) —
  `src/app.ts:118-167`
- [x] Admin-only API key listing endpoint — `src/app.ts:170-193`

### Runtime / Build

- [x] Migration to Bun runtime — commit `a3dc41f`
- [x] Conditional SQLite import for Bun/Node test compatibility —
  commit `a87d4c3`
- [x] Docker build uses `--filter` and isolated web build —
  commits `152d2b1`, `c0b370d`

### Infrastructure (2026-03-19, recorded in sharkfin tracker)

- [x] Passport VM recreated with persistent `/data` drive
- [x] Passport restart policy set to `always`

---

## Deferred

_None._ All known issues are either tracked under "Open" or have been
fixed.

---

## Planned

### Production-mode hardening

Triggered on `NODE_ENV=production` or non-localhost host:

- Refuse to start with `http://` `BETTER_AUTH_URL`
- Refuse to start with `BETTER_AUTH_SECRET` shorter than 32 characters
  (currently only presence is checked)
- Default `apiKey` rate limiting back on with a sane externally-facing
  cap, override-able per key

### Application-level rate limiting

Closes audit #8. Per-IP limits on `/v1/sign-in/email` and
`/v1/sign-up/email`; per-key limits on `/v1/verify-api-key`. Hono has
middleware available; needs to be wired and tested against the
verify-api-key cache TTL semantics in the Go validator so we don't
regress the "verify load" justification for disabling Better Auth's
per-key limiter.
