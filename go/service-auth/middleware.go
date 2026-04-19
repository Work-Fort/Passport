// SPDX-License-Identifier: Apache-2.0

package auth

import (
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

// NewFromValidators creates middleware from explicit Validator implementations.
// Validators are tried in order — the first successful validation wins.
// Typical usage in a service's main():
//
//	opts := auth.DefaultOptions("http://127.0.0.1:3000")
//	jwtV, _ := jwt.New(ctx, opts.JWKSURL, opts.JWKSRefreshInterval)
//	akV := apikey.New(opts.VerifyAPIKeyURL, opts.APIKeyCacheTTL)
//	mw := auth.NewFromValidators(jwtV, akV)
//	mux.Handle("/v1/", mw(apiHandler))
func NewFromValidators(validators ...Validator) Middleware {
	if len(validators) == 0 {
		panic("auth: at least one validator required")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := extractBearer(r)
			if !ok {
				writeError(w, http.StatusUnauthorized, ErrNoToken.Error())
				return
			}

			var id Identity
			var lastErr error
			for _, v := range validators {
				id, lastErr = v.Validate(r.Context(), token)
				if lastErr == nil {
					break
				}
			}
			if lastErr != nil {
				writeError(w, http.StatusUnauthorized, ErrInvalidToken.Error())
				return
			}

			ctx := ContextWithIdentity(r.Context(), id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// extractBearer extracts the token from "Authorization: Bearer <token>".
// The "Bearer" prefix is matched case-sensitively, which is stricter than
// RFC 6750 but consistent with the Go ecosystem and better-auth's behavior.
func extractBearer(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	token, found := strings.CutPrefix(h, "Bearer ")
	if !found || token == "" {
		return "", false
	}
	return token, true
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
