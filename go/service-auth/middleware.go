// SPDX-License-Identifier: Apache-2.0

package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

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

// Middleware is a function that wraps an http.Handler with authentication.
type Middleware func(http.Handler) http.Handler

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

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
