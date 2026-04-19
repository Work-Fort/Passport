---
type: plan
step: "1"
title: "Auth scheme dispatch — split JWT and API-key Authorization schemes"
status: approved
assessment_status: complete
provenance:
  source: forensic-finding
  issue_id: "Cluster 3b (2026-04-19 Sharkfin investigation)"
  roadmap_step: null
dates:
  created: "2026-04-19"
  approved: "2026-04-19"
  completed: null
related_plans:
  - sharkfin/lead/docs/plans/2026-04-19-passport-scheme-split-consumer.md
  - flow/lead/docs/plans/2026-04-19-passport-scheme-split-consumer.md
  - hive/lead/docs/plans/2026-04-19-passport-scheme-split-consumer.md
  - pylon/lead/docs/plans/2026-04-19-passport-scheme-split-consumer.md
  - combine/lead/docs/plans/2026-04-19-passport-scheme-split-consumer.md
---

# Passport service-auth — Scheme Dispatch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the validator-chain fallthrough in `service-auth/middleware.go` with explicit scheme-based dispatch. `Authorization: Bearer <jwt>` routes to the JWT validator only; `Authorization: ApiKey-v1 <key>` routes to the API-key validator only; any other scheme returns 401 immediately. This mechanically eliminates the Cluster 3b class of bug (a malformed JWT being silently retried as an API key, widening the brute-force surface and producing noisy `verify-api-key` calls).

**Architecture:** The current `NewFromValidators` walks an ordered slice and breaks on the first `nil` error from any validator. The new design owns scheme parsing in middleware itself and dispatches to a single named validator. The public API stays familiar (still constructed from a JWT validator + an API-key validator) but the constructor is renamed to `NewSchemeDispatch(jwtV, apiKeyV)` to make the new contract obvious at the call site and force every consumer to update intentionally. The legacy `NewFromValidators` is removed in the same commit — there is no transition period because the only WorkFort cluster is local (confirmed via `~/Work/WorkFort/INTEGRATION-ENVIRONMENT.md`).

The `ApiKey-v1` versioned scheme name leaves room for future API-key formats (`ApiKey-v2`, etc.) without a second flag day.

**Tech Stack:** Go 1.x, `net/http`, `strings`, `testing`. No new dependencies.

---

## Conventions (apply to every task)

- All commits use Conventional Commits format **multi-line with body + `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` trailer**, every commit, regardless of size.
- Tests live next to source: `go/service-auth/middleware_test.go` for middleware tests.
- Run tests with: `cd go/service-auth && go test ./...`
- Run a single test: `cd go/service-auth && go test -run TestMiddleware_BearerDispatchesToJWT -v ./...`
- After every behavioral change: run the full module suite (`go test ./...`) AND `go vet ./...`.
- Keep tests table-driven where it reads naturally; do not over-engineer single-case tests into tables.
- Do NOT push until the cross-repo cutover (Plan 2) is ready — see "Coordination" at the bottom of this plan.

---

## Pre-flight investigation summary (already done by planner)

| Question | Answer |
|---|---|
| Is there a transition window? | **No.** Only one local cluster (`INTEGRATION-ENVIRONMENT.md`). Atomic cutover. |
| Does the apikey validator do shape-checking on input today? | No. It POSTs anything to `/v1/verify-api-key`. After the split, only canonically-prefixed strings (`wf-agent_*`, `wf-svc_*`) reach it via the new scheme — but the validator still trusts the upstream Passport response. |
| Does the JWT validator have a side effect on malformed input? | No. `jwtlib.Parse` is pure; failure returns an error. So the regression we're closing is purely the network amplification + log noise from the fallthrough call to `verify-api-key`. |
| Are there other in-tree consumers besides what's listed? | Only Go consumers reach `service-auth/middleware`. Scope (Rust BFF) is out of scope for this plan. |

---

### Task 1: Add scheme constants and a parser helper (no behavior change yet)

**Files:**
- Modify: `go/service-auth/middleware.go`
- Test: `go/service-auth/middleware_test.go`

**Step 1: Write failing tests for the parser**

Add to `middleware_test.go` (top of file, after existing imports):

```go
func TestParseAuthScheme(t *testing.T) {
	tests := []struct {
		name       string
		header     string
		wantScheme string
		wantToken  string
		wantOK     bool
	}{
		{"bearer jwt", "Bearer eyJhbGciOi.payload.sig", "Bearer", "eyJhbGciOi.payload.sig", true},
		{"apikey v1", "ApiKey-v1 wf-agent_abc", "ApiKey-v1", "wf-agent_abc", true},
		{"empty header", "", "", "", false},
		{"scheme only no token", "Bearer", "", "", false},
		{"scheme only with trailing space no token", "Bearer ", "", "", false},
		{"lowercase bearer parsed permissively", "bearer foo", "bearer", "foo", true}, // parser is permissive; dispatcher enforces case-sensitive match
		{"unknown scheme", "Basic dXNlcjpwYXNz", "Basic", "dXNlcjpwYXNz", true},
		{"extra spaces collapsed only at the split point", "Bearer  two-spaces", "Bearer", " two-spaces", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scheme, token, ok := parseAuthScheme(tt.header)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if scheme != tt.wantScheme {
				t.Errorf("scheme = %q, want %q", scheme, tt.wantScheme)
			}
			if token != tt.wantToken {
				t.Errorf("token = %q, want %q", token, tt.wantToken)
			}
		})
	}
}
```

**Step 2: Run and confirm failure**

```
cd go/service-auth && go test -run TestParseAuthScheme -v ./...
```

Expected: FAIL — `undefined: parseAuthScheme`.

**Step 3: Implement the parser**

Replace the existing `extractBearer` with a more general parser. In `middleware.go`:

```go
// SchemeBearer is the Authorization scheme for Passport JWTs.
const SchemeBearer = "Bearer"

// SchemeApiKeyV1 is the Authorization scheme for Passport API keys
// (formats: wf-agent_*, wf-svc_*).
//
// Versioned to allow future API-key formats (ApiKey-v2, ...) without a
// second flag day across consumers.
const SchemeApiKeyV1 = "ApiKey-v1"

// parseAuthScheme splits an Authorization header into its scheme and token
// at the first space. The scheme is returned verbatim (case-sensitive match
// is the responsibility of the dispatcher). Returns ok=false only when the
// header is empty or there is no space-separated token.
func parseAuthScheme(h string) (scheme, token string, ok bool) {
	if h == "" {
		return "", "", false
	}
	idx := strings.IndexByte(h, ' ')
	if idx < 0 || idx == len(h)-1 {
		return "", "", false
	}
	return h[:idx], h[idx+1:], true
}
```

Leave `extractBearer` in place for now — it will be removed in Task 3.

**Step 4: Run tests to verify pass**

```
cd go/service-auth && go test -run TestParseAuthScheme -v ./...
```

Expected: all subtests PASS.

**Step 5: Commit**

```bash
git add go/service-auth/middleware.go go/service-auth/middleware_test.go
git commit -m "$(cat <<'EOF'
refactor(service-auth): introduce parseAuthScheme + scheme constants

Add SchemeBearer ("Bearer") and SchemeApiKeyV1 ("ApiKey-v1") constants
and a parseAuthScheme helper that splits the Authorization header at the
first space. No behavior change — extractBearer is still the only caller.
This is the foundation for the scheme-dispatch middleware (next commit).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Write the failing scheme-dispatch middleware tests

**Files:**
- Test: `go/service-auth/middleware_test.go`

**Step 1: Add the new test cases**

Append these tests (do NOT delete the old ones yet — they document the behavior we're replacing and will be deleted explicitly in Task 4):

```go
func TestMiddleware_BearerDispatchesToJWT(t *testing.T) {
	want := Identity{ID: "user-1", Username: "alice", Type: TypeUser}
	jwtV := &mockValidator{identity: want}
	apiKeyV := &mockValidator{err: fmt.Errorf("api-key validator must not be called")}

	mw := NewSchemeDispatch(jwtV, apiKeyV)

	var got Identity
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = MustIdentity(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/v1/x", nil)
	req.Header.Set("Authorization", "Bearer some.jwt.payload")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got.ID != want.ID {
		t.Errorf("identity.ID = %q, want %q", got.ID, want.ID)
	}
}

func TestMiddleware_ApiKeyV1DispatchesToApiKey(t *testing.T) {
	want := Identity{ID: "agent-1", Username: "deploy-bot", Type: TypeAgent}
	jwtV := &mockValidator{err: fmt.Errorf("jwt validator must not be called")}
	apiKeyV := &mockValidator{identity: want}

	mw := NewSchemeDispatch(jwtV, apiKeyV)

	var got Identity
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = MustIdentity(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/v1/x", nil)
	req.Header.Set("Authorization", "ApiKey-v1 wf-agent_secret")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got.Type != TypeAgent {
		t.Errorf("identity.Type = %q, want %q", got.Type, TypeAgent)
	}
}

// TestMiddleware_MalformedJWTDoesNotFallThrough is the regression-prevention
// test for Cluster 3b (2026-04-19 forensic finding). A garbled JWT under the
// Bearer scheme MUST fail with 401 — it must NOT be retried against the
// API-key validator. We assert this by counting calls to the API-key
// validator's Validate method.
func TestMiddleware_MalformedJWTDoesNotFallThrough(t *testing.T) {
	jwtV := &mockValidator{err: fmt.Errorf("jwt: parse/validate: malformed token")}
	apiKeyCalls := 0
	apiKeyV := &countingValidator{onValidate: func() { apiKeyCalls++ }}

	mw := NewSchemeDispatch(jwtV, apiKeyV)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler must not be called for a failed JWT")
	}))

	req := httptest.NewRequest("GET", "/v1/x", nil)
	req.Header.Set("Authorization", "Bearer not.a.real.jwt")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if apiKeyCalls != 0 {
		t.Errorf("API-key validator was called %d times; expected 0 (no fallthrough)", apiKeyCalls)
	}
}

func TestMiddleware_UnknownSchemeReturns401(t *testing.T) {
	jwtV := &mockValidator{err: fmt.Errorf("jwt validator must not be called")}
	apiKeyV := &mockValidator{err: fmt.Errorf("api-key validator must not be called")}

	mw := NewSchemeDispatch(jwtV, apiKeyV)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler must not be called for an unknown scheme")
	}))

	cases := []struct {
		name   string
		header string
	}{
		{"basic", "Basic dXNlcjpwYXNz"},
		{"lowercase bearer", "bearer some-token"},
		{"lowercase apikey", "apikey-v1 some-key"},
		{"future apikey v2", "ApiKey-v2 some-key"},
		{"empty", ""},
		{"scheme only", "Bearer"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/v1/x", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", rec.Code)
			}
		})
	}
}

// countingValidator is a test double that increments a counter every time
// Validate is called, and always returns an error so the test can prove
// "this validator was never reached".
type countingValidator struct {
	onValidate func()
}

func (c *countingValidator) Validate(_ context.Context, _ string) (Identity, error) {
	if c.onValidate != nil {
		c.onValidate()
	}
	return Identity{}, fmt.Errorf("countingValidator: always fail")
}
```

Note: the `AlwaysFail` helper tests and `TestMiddleware_FailedValidatorUnderCorrectSchemeReturns401` are added in Task 3 alongside the implementation that satisfies them — they're listed there because they all belong to the same red-then-green commit cycle for the constructor + helper. Keeping the four scheme-dispatch tests in this Task 2 commit keeps the regression-prevention test for Cluster 3b (`TestMiddleware_MalformedJWTDoesNotFallThrough`) clearly attributable.

**Step 2: Run and confirm failure**

```
cd go/service-auth && go test -run "TestMiddleware_BearerDispatchesToJWT|TestMiddleware_ApiKeyV1DispatchesToApiKey|TestMiddleware_MalformedJWTDoesNotFallThrough|TestMiddleware_UnknownSchemeReturns401" -v ./...
```

Expected: FAIL — `undefined: NewSchemeDispatch`.

**Step 3: Commit (red — tests-only commit)**

```bash
git add go/service-auth/middleware_test.go
git commit -m "$(cat <<'EOF'
test(service-auth): add failing tests for scheme-dispatch middleware

Adds the four tests that define the new middleware contract:
- Bearer dispatches to the JWT validator only.
- ApiKey-v1 dispatches to the API-key validator only.
- A malformed JWT under Bearer does NOT fall through to API-key
  (regression-prevention test for Cluster 3b, 2026-04-19 forensic).
- Any other scheme (Basic, lowercase bearer, ApiKey-v2, empty,
  scheme-only) returns 401 immediately.

These fail with "undefined: NewSchemeDispatch"; the implementation
lands in the next commit.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Implement `NewSchemeDispatch` (turn the new tests green)

**Files:**
- Modify: `go/service-auth/middleware.go`

**Step 1: Add the new constructor**

Add to `middleware.go` (place above `NewFromValidators`, leaving the old one intact for now):

```go
// NewSchemeDispatch creates middleware that dispatches by Authorization
// scheme:
//
//   - "Bearer <jwt>"      → jwtV.Validate(ctx, jwt)
//   - "ApiKey-v1 <key>"   → apiKeyV.Validate(ctx, key)
//   - anything else        → 401
//
// There is no fallthrough: a failed JWT validation does NOT cause the
// API-key validator to be tried (and vice versa). This eliminates the
// Cluster 3b class of bug where a garbled JWT was silently amplified
// into a verify-api-key call against Passport.
//
// Scheme matching is case-sensitive — "bearer" (lowercase) is rejected
// with 401, mirroring better-auth's behavior and the existing
// case-sensitivity contract documented in TestMiddleware_BearerCaseSensitive.
//
// Both validators are REQUIRED (non-nil). If your service genuinely
// only accepts one auth type — for example, JWKS init failed at startup
// and the daemon should still serve API-key traffic — pass the
// AlwaysFail helper exported from this package as a fail-closed stub:
//
//	jwtV, err := jwt.New(ctx, jwksURL, refresh)
//	if err != nil {
//	    jwtV = auth.AlwaysFail(fmt.Errorf("jwt validator unavailable: %w", err))
//	}
//	mw := auth.NewSchemeDispatch(jwtV, apiKeyV)
//
// Do NOT reimplement this stub in each consumer — use AlwaysFail so
// the failure mode stays consistent across services.
func NewSchemeDispatch(jwtV, apiKeyV Validator) Middleware {
	if jwtV == nil || apiKeyV == nil {
		panic("auth: NewSchemeDispatch requires non-nil JWT and API-key validators (use auth.AlwaysFail for a fail-closed stub)")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scheme, token, ok := parseAuthScheme(r.Header.Get("Authorization"))
			if !ok {
				writeError(w, http.StatusUnauthorized, ErrNoToken.Error())
				return
			}

			var v Validator
			switch scheme {
			case SchemeBearer:
				v = jwtV
			case SchemeApiKeyV1:
				v = apiKeyV
			default:
				writeError(w, http.StatusUnauthorized, ErrInvalidToken.Error())
				return
			}

			id, err := v.Validate(r.Context(), token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, ErrInvalidToken.Error())
				return
			}

			ctx := ContextWithIdentity(r.Context(), id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
```

**Step 2: Add the `AlwaysFail` helper (single source of truth for the JWKS-init-failure case)**

Add to `middleware.go` immediately above `NewSchemeDispatch`:

```go
// AlwaysFail returns a Validator that rejects every input with the
// given error. Use it as a fail-closed substitute for the JWT validator
// when JWKS init fails at startup but you still want the API-key path
// to serve traffic. NewSchemeDispatch requires both validators non-nil;
// AlwaysFail satisfies that contract without enabling any auth.
//
//	jwtV, err := jwt.New(ctx, jwksURL, refresh)
//	if err != nil {
//	    log.Warn("jwt validator init failed; serving API-key only", "err", err)
//	    jwtV = auth.AlwaysFail(fmt.Errorf("jwt validator unavailable: %w", err))
//	}
//	mw := auth.NewSchemeDispatch(jwtV, apiKeyV)
//
// This is the ONLY supported pattern for "one validator unavailable" —
// downstream consumers MUST NOT reimplement this stub locally.
func AlwaysFail(err error) Validator {
	if err == nil {
		err = ErrInvalidToken
	}
	return alwaysFailValidator{err: err}
}

type alwaysFailValidator struct{ err error }

func (a alwaysFailValidator) Validate(_ context.Context, _ string) (Identity, error) {
	return Identity{}, a.err
}
```

Add a test for `AlwaysFail` to `middleware_test.go`:

```go
func TestAlwaysFail_AlwaysReturnsTheError(t *testing.T) {
	want := fmt.Errorf("jwt validator unavailable: jwks fetch failed")
	v := AlwaysFail(want)

	id, err := v.Validate(context.Background(), "anything-at-all")
	if err == nil || err.Error() != want.Error() {
		t.Fatalf("err = %v, want %v", err, want)
	}
	if id.ID != "" {
		t.Errorf("id.ID = %q, want \"\"", id.ID)
	}
}

func TestAlwaysFail_NilErrorFallsBackToErrInvalidToken(t *testing.T) {
	v := AlwaysFail(nil)
	_, err := v.Validate(context.Background(), "anything")
	if err == nil || !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("err = %v, want ErrInvalidToken sentinel", err)
	}
}
```

Add a test that **a failed validator under the correct scheme returns 401** (covers the gap left when the legacy `TestMiddleware_AllValidatorsFail` is deleted in Task 4):

```go
func TestMiddleware_FailedValidatorUnderCorrectSchemeReturns401(t *testing.T) {
	// API-key validator under ApiKey-v1: failure returns 401 (no fallback to JWT).
	jwtV := &mockValidator{err: fmt.Errorf("jwt validator must not be called")}
	apiKeyV := &mockValidator{err: fmt.Errorf("apikey: verify-api-key returned 401")}

	mw := NewSchemeDispatch(jwtV, apiKeyV)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler must not be called when the dispatched validator fails")
	}))

	req := httptest.NewRequest("GET", "/v1/x", nil)
	req.Header.Set("Authorization", "ApiKey-v1 wf-svc_revoked")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
```

**Step 3: Run the new tests to verify pass**

```
cd go/service-auth && go test -run "TestMiddleware_BearerDispatchesToJWT|TestMiddleware_ApiKeyV1DispatchesToApiKey|TestMiddleware_MalformedJWTDoesNotFallThrough|TestMiddleware_UnknownSchemeReturns401|TestMiddleware_FailedValidatorUnderCorrectSchemeReturns401|TestParseAuthScheme|TestAlwaysFail" -v ./...
```

Expected: all PASS.

**Step 4: Run the full module to check what we've broken**

```
cd go/service-auth && go test ./...
```

Expected: the legacy `TestMiddleware_FallbackToSecondValidator` and `TestMiddleware_AllValidatorsFail` will still pass — they exercise the legacy `NewFromValidators` constructor which is intact in this commit. `TestMiddleware_BearerCaseSensitive`, `TestMiddleware_NoAuthHeader`, etc. should still pass. If anything else fails, **stop and ask** — that's a sign the new code has an unintended side effect.

**Step 5: Commit**

```bash
git add go/service-auth/middleware.go go/service-auth/middleware_test.go
git commit -m "$(cat <<'EOF'
feat(service-auth): NewSchemeDispatch + AlwaysFail — explicit scheme routing

Adds NewSchemeDispatch(jwtV, apiKeyV) — middleware that parses the
Authorization header's scheme and dispatches to a single validator:

  Bearer <jwt>      → JWT validator only
  ApiKey-v1 <key>   → API-key validator only
  anything else      → 401 immediately

No fallthrough: a failed JWT validation will NOT be retried as an
API key, mechanically eliminating the Cluster 3b class of bug
(2026-04-19 Sharkfin forensic — a malformed JWT was being POSTed to
the unauthenticated /v1/verify-api-key endpoint and amplifying brute-
force surface + log noise).

Also exports AlwaysFail(err) Validator: a fail-closed stub for the
case where one validator can't be initialized at startup (e.g. JWKS
fetch failure) and the daemon should still serve the other path.
NewSchemeDispatch requires both validators non-nil; consumers must
use AlwaysFail rather than reimplementing the same five-line stub
in every service.

The legacy NewFromValidators is preserved in this commit; it is
removed in the next commit once consumers have migrated. Tests for
the new contract (incl. failed-validator-under-correct-scheme and
AlwaysFail behavior) are already green from the previous test commit.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Delete the legacy `NewFromValidators` and `extractBearer`

**Files:**
- Modify: `go/service-auth/middleware.go`
- Modify: `go/service-auth/middleware_test.go`
- Modify: `go/service-auth/README.md`

**Step 1: Delete the legacy code**

In `middleware.go`:
- Delete the `NewFromValidators` function (the entire body, including its doc comment).
- Delete the `extractBearer` function (no longer called).

In `middleware_test.go`:
- Delete `TestMiddleware_ValidToken_FirstValidator` (uses `NewFromValidators`).
- Delete `TestMiddleware_FallbackToSecondValidator` (this is the test that encoded the bug we're closing).
- Delete `TestMiddleware_AllValidatorsFail` (uses `NewFromValidators`).
- Delete `TestMiddleware_WebSocketUpgrade` if it uses `NewFromValidators` — but rewrite it to use `NewSchemeDispatch(jwtV, alwaysFailingApiKey)` instead, since WebSocket auth coverage is load-bearing. (Quick rewrite shown below.)
- Delete `TestMiddleware_BearerCaseSensitive` if it uses `NewFromValidators`, but rewrite the same way to keep coverage.

Rewrite for WebSocket test:

```go
func TestMiddleware_WebSocketUpgrade(t *testing.T) {
	want := Identity{ID: "user-2", Username: "bob", Type: TypeUser}
	jwtV := &mockValidator{identity: want}
	apiKeyV := &mockValidator{err: fmt.Errorf("must not be called")}

	mw := NewSchemeDispatch(jwtV, apiKeyV)

	var got Identity
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = MustIdentity(r.Context())
		w.WriteHeader(http.StatusSwitchingProtocols)
	}))

	req := httptest.NewRequest("GET", "/ws", nil)
	req.Header.Set("Authorization", "Bearer valid-jwt-token")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", rec.Code)
	}
	if got.ID != want.ID {
		t.Errorf("identity.ID = %q, want %q", got.ID, want.ID)
	}
}
```

The case-sensitive coverage is already provided by `TestMiddleware_UnknownSchemeReturns401` (the "lowercase bearer" subtest). Delete `TestMiddleware_BearerCaseSensitive` outright.

`TestMiddleware_NoAuthHeader` should be rewritten to use `NewSchemeDispatch`:

```go
func TestMiddleware_NoAuthHeader(t *testing.T) {
	mw := NewSchemeDispatch(
		&mockValidator{err: fmt.Errorf("must not be called")},
		&mockValidator{err: fmt.Errorf("must not be called")},
	)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/v1/x", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	var errBody map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&errBody); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if errBody["error"] != ErrNoToken.Error() {
		t.Errorf("error = %q, want %q", errBody["error"], ErrNoToken.Error())
	}
}
```

**Step 2: Update README.md**

In `go/service-auth/README.md`, replace the "Middleware" and "Usage" sections with the new constructor + scheme contract. Specifically:

- In the **Usage** section, change `mw := auth.NewFromValidators(jwtV, akV)` to `mw := auth.NewSchemeDispatch(jwtV, akV)`.
- Replace the entire **Middleware** section body with the content described below.

Open `go/service-auth/README.md` and rewrite the section. The new body has four parts:

1. A short paragraph: "`NewSchemeDispatch` wraps an `http.Handler` and routes by `Authorization` scheme."
2. A markdown table with three rows:

   | Scheme | Validator | Token shape |
   | --- | --- | --- |
   | `Bearer` | JWT validator only | A Passport-issued JWT |
   | `ApiKey-v1` | API-key validator only | `wf-agent_*` or `wf-svc_*` |
   | (anything else) | — | 401 immediately |

3. A no-fallthrough paragraph: "There is no fallthrough between validators. A failed JWT validation returns 401 directly — it is not retried as an API key. This mechanically eliminates the class of bug where a garbled JWT was silently amplified into a `/v1/verify-api-key` call. If you need to serve only one auth path because the other validator could not be initialized, pass `auth.AlwaysFail(err)` for the missing one — both validators must be non-nil."
4. A code-fenced Go example calling `auth.NewSchemeDispatch`, followed by a code-fenced JSON example of the 401 response bodies, followed by a code-fenced wire-format example listing `Authorization: Bearer …` and `Authorization: ApiKey-v1 …`.

(Each code fence in the README is a single ` ```go ` / ` ```json ` / ` ``` ` block — keep them as separate top-level fences in the file, not nested.)

**Step 3: Run the full module**

```
cd go/service-auth && go test ./... && go vet ./...
```

Expected: all PASS, no vet warnings.

**Step 4: Commit**

```bash
git add go/service-auth/middleware.go go/service-auth/middleware_test.go go/service-auth/README.md
git commit -m "$(cat <<'EOF'
feat(service-auth)!: remove legacy NewFromValidators and Bearer-for-API-key

BREAKING CHANGE: NewFromValidators is removed. All consumers must
migrate to NewSchemeDispatch and send API keys under the new
Authorization scheme:

  Authorization: ApiKey-v1 wf-agent_xxx   (was: Bearer wf-agent_xxx)

JWTs continue to use Bearer unchanged.

Removes the validator-chain fallthrough (the Cluster 3b root cause)
and the now-unused extractBearer helper. Test coverage migrated to
the new constructor: WebSocket-upgrade and no-auth-header tests
preserved against NewSchemeDispatch; case-sensitivity is now covered
by TestMiddleware_UnknownSchemeReturns401's "lowercase bearer" case.

README updated with the new wire format table and explicit
no-fallthrough guarantee.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update remaining-work.md (mark Cluster 3b done, retire the Planned section)

**Files:**
- Modify: `docs/remaining-work.md`

**Step 1: Move the Cluster 3b entry**

Cut the entire "Cluster 3b" entry from the "Open → Bugs" list (lines starting with "**High — Validator fallthrough on shared bearer string**" through the test-file reference).

Paste it under "Recently Completed" → add a new subsection at the top of that section:

```markdown
### Auth scheme dispatch (2026-04-19)

- [x] **Cluster 3b — validator fallthrough.** Resolved by splitting JWT
  and API-key auth into explicit `Authorization` schemes
  (`Bearer` / `ApiKey-v1`). `service-auth/middleware.go` now dispatches
  by scheme with no fallthrough; a malformed JWT can no longer leak to
  `/v1/verify-api-key`. Regression-prevention test:
  `TestMiddleware_MalformedJWTDoesNotFallThrough`. Cross-repo consumer
  migration tracked in `~/Work/WorkFort/AGENT-POOL-REMAINING-WORK.md`
  § "Passport auth scheme split (2026-04-19, in flight)".
```

**Step 2: Retire the Planned section**

Delete the entire "### Validator routing — explicit scheme dispatch (chosen path, 2026-04-19)" section under "Planned" — it is now done. Leave the other Planned subsections ("Production-mode hardening", "Application-level rate limiting") in place.

**Step 3: Commit**

```bash
git add docs/remaining-work.md
git commit -m "$(cat <<'EOF'
docs(remaining-work): mark Cluster 3b done; retire scheme-dispatch Planned section

Cluster 3b (validator fallthrough) is closed by the scheme-dispatch
middleware change. Move the "Open → Bugs" entry to Recently Completed
with a regression-test reference, and delete the now-stale Planned
subsection that described the chosen path.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Coordination

**DO NOT push these commits until the deploy runbook calls for it.** Pushing a breaking change to passport before consumers are updated will break every other Go service's build (they consume `service-auth` via `go get`).

The authoritative push order lives in `~/Work/WorkFort/passport-scheme-split-deploy.md`. The work pipeline is:

1. **Local dev loop (no pushes yet).** Each consumer pins this passport branch via a `replace` directive in their `go.mod` and verifies their migration locally against the pre-release scheme-dispatch code. The replace directives are NOT pushed.
2. **Push passport (Step 1 of the runbook).** Land + push this plan's commits (Tasks 1-5). Wait for `semver-tagging-action` to publish the new `go/service-auth/v<X.Y.Z>` tag.
3. **Each consumer drops the `replace`, runs `go get -u github.com/Work-Fort/Passport/go/service-auth@<new-tag>`, retests, and pushes the version bump** (Steps 3-6 of the runbook). The replace directives never reach the remote.

The Team Lead coordinates the actual push order via the runbook. Do not push from this plan without explicit Team Lead green-light.

---

## Rollback plan

If a critical bug is found post-cutover:

- `git revert` the `feat!` commit (Task 4). The legacy `NewFromValidators` returns; consumers can fall back to sending API keys as `Bearer` until the issue is fixed.
- Note: this temporarily reopens Cluster 3b. Revert is a defensive option, not a steady state.
