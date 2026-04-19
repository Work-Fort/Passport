# service-auth

[![Go Reference](https://pkg.go.dev/badge/github.com/Work-Fort/Passport/go/service-auth.svg)](https://pkg.go.dev/github.com/Work-Fort/Passport/go/service-auth)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE.md)

Package `auth` provides HTTP authentication middleware for Go services in the
WorkFort ecosystem. It validates JWTs and API keys issued by
[Passport](https://github.com/Work-Fort/Passport) and populates the request
context with a verified `Identity`.

```bash
go get github.com/Work-Fort/Passport/go/service-auth
```

## Usage

```go
package main

import (
	"context"
	"log"
	"net/http"

	auth "github.com/Work-Fort/Passport/go/service-auth"
	"github.com/Work-Fort/Passport/go/service-auth/apikey"
	"github.com/Work-Fort/Passport/go/service-auth/jwt"
)

func main() {
	ctx := context.Background()
	opts := auth.DefaultOptions("http://127.0.0.1:3000")

	jwtV, err := jwt.New(ctx, opts.JWKSURL, opts.JWKSRefreshInterval)
	if err != nil {
		log.Fatalf("jwt validator: %v", err)
	}
	defer jwtV.Close()

	akV := apikey.New(opts.VerifyAPIKeyURL, opts.APIKeyCacheTTL)
	mw := auth.NewSchemeDispatch(jwtV, akV)

	mux := http.NewServeMux()
	mux.Handle("GET /v1/health", http.HandlerFunc(healthHandler))
	mux.Handle("/v1/", mw(http.HandlerFunc(apiHandler)))

	log.Fatal(http.ListenAndServe(":8080", mux))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte(`{"status":"ok"}`))
}

func apiHandler(w http.ResponseWriter, r *http.Request) {
	id := auth.MustIdentity(r.Context())
	log.Printf("request from %s (type=%s)", id.Username, id.Type)
	w.Write([]byte(`{"ok":true}`))
}
```

## Identity

The middleware populates an `Identity` in the request context for every
authenticated request:

```go
type Identity struct {
	ID          string // UUID, stable primary key
	Username    string // unique handle (e.g. "agent-deploy-01", "svc-sharkfin")
	Name        string // full name (e.g. "Deploy Agent 01", "Sharkfin Service")
	DisplayName string // short name (e.g. "Deploy Agent", "Sharkfin")
	Type        string // "user", "agent", or "service"
}
```

Three identity types are defined as constants:

| Constant | Value | Auth method |
|----------|-------|-------------|
| `auth.TypeUser` | `"user"` | JWT |
| `auth.TypeAgent` | `"agent"` | API key |
| `auth.TypeService` | `"service"` | API key |

Use `ID` (UUID) for database foreign keys. Use `Username` for unique references
in logs and API identifiers.

## Context helpers

```go
// Returns the identity and true, or a zero value and false.
id, ok := auth.IdentityFromContext(r.Context())

// Panics if called outside auth middleware. Use in handlers that are
// guaranteed to be protected.
id := auth.MustIdentity(r.Context())
```

## Middleware

`NewSchemeDispatch` wraps an `http.Handler` and routes by `Authorization` scheme.

| Scheme | Validator | Token shape |
| --- | --- | --- |
| `Bearer` | JWT validator only | A Passport-issued JWT |
| `ApiKey-v1` | API-key validator only | `wf-agent_*` or `wf-svc_*` |
| (anything else) | — | 401 immediately |

There is no fallthrough between validators. A failed JWT validation returns 401 directly — it is not retried as an API key. This mechanically eliminates the class of bug where a garbled JWT was silently amplified into a `/v1/verify-api-key` call. If you need to serve only one auth path because the other validator could not be initialized, pass `auth.AlwaysFail(err)` for the missing one — both validators must be non-nil.

```go
jwtV, err := jwt.New(ctx, opts.JWKSURL, opts.JWKSRefreshInterval)
if err != nil {
    // Fail closed: serve API-key traffic, reject all Bearer requests.
    jwtV = auth.AlwaysFail(fmt.Errorf("jwt validator unavailable: %w", err))
}
akV := apikey.New(opts.VerifyAPIKeyURL, opts.APIKeyCacheTTL)
mw := auth.NewSchemeDispatch(jwtV, akV)
mux.Handle("/v1/", mw(protectedHandler))
```

Missing or invalid tokens receive a `401 Unauthorized` JSON response:

```json
{"error": "auth: missing Authorization header"}
{"error": "auth: invalid token"}
```

Wire format for the two supported schemes:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiJ9...
Authorization: ApiKey-v1 wf-agent_xxxxxxxxxxxxxxxx
```

## Validators

### jwt

Package `jwt` validates tokens against Passport's JWKS endpoint with
automatic key refresh.

```go
jwtV, err := jwt.New(ctx, opts.JWKSURL, opts.JWKSRefreshInterval)
if err != nil {
	log.Fatal(err) // fails fast if JWKS endpoint is unreachable
}
defer jwtV.Close()
```

- Initial JWKS fetch on creation — fails immediately if the auth service is down.
- Background goroutine refreshes keys at the configured interval.
- Validation is pure local crypto — no per-request roundtrip to the auth service.

### apikey

Package `apikey` validates API keys by calling Passport's verify endpoint.
Results are cached in memory.

```go
akV := apikey.New(opts.VerifyAPIKeyURL, opts.APIKeyCacheTTL)
```

- Calls `POST /v1/verify-api-key` with `{"key": "<token>"}`.
- Caches successful results for the configured TTL (default 30s).
- A revoked key remains valid for up to the cache TTL.

**Key prefixes:**

| Identity type | Prefix |
|---------------|--------|
| Agent | `wf-agent_` |
| Service | `wf-svc_` |

## Options

`DefaultOptions` returns sensible defaults for a given Passport base URL:

```go
opts := auth.DefaultOptions("http://127.0.0.1:3000")
// opts.JWKSURL             → "http://127.0.0.1:3000/v1/jwks"
// opts.VerifyAPIKeyURL     → "http://127.0.0.1:3000/v1/verify-api-key"
// opts.JWKSRefreshInterval → 20m
// opts.APIKeyCacheTTL      → 30s
```

Override individual fields as needed:

```go
opts := auth.DefaultOptions("http://passport:3000")
opts.JWKSRefreshInterval = 1 * time.Minute
opts.APIKeyCacheTTL = 10 * time.Second
```

## WebSocket authentication

Apply the auth middleware to the upgrade handler. The identity extracted during
the HTTP upgrade is trusted for the lifetime of the connection.

```go
mux.Handle("/ws", mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	id := auth.MustIdentity(r.Context())
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	// id is valid for the life of conn
})))
```

## License

Licensed under the Apache License 2.0. See [LICENSE.md](LICENSE.md) for details.
