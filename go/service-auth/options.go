package auth

import "time"

// Options configures the auth middleware. Fields are set directly; use
// DefaultOptions() for sensible defaults. URL fields are derived from
// AuthServiceURL.
//
// Wiring example in a service's main():
//
//	opts := auth.DefaultOptions("http://127.0.0.1:3000")
//	jwtV, _ := jwt.New(ctx, opts.JWKSURL, opts.JWKSRefreshInterval)
//	akV := apikey.New(opts.VerifyAPIKeyURL, opts.APIKeyCacheTTL)
//	mw := auth.NewFromValidators(jwtV, akV)
type Options struct {
	// AuthServiceURL is the base URL of the better-auth service.
	// Example: "http://127.0.0.1:3000"
	AuthServiceURL string

	// JWKSURL is the full JWKS endpoint URL.
	// Derived from AuthServiceURL by DefaultOptions().
	JWKSURL string

	// VerifyAPIKeyURL is the full API key verification endpoint URL.
	// Derived from AuthServiceURL by DefaultOptions().
	VerifyAPIKeyURL string

	// JWKSRefreshInterval controls how often the JWKS key set is refreshed.
	// Default: 5 minutes.
	JWKSRefreshInterval time.Duration

	// APIKeyCacheTTL controls how long verified API key results are cached.
	// A revoked key remains valid for up to this duration.
	// Default: 30 seconds.
	APIKeyCacheTTL time.Duration
}

// DefaultOptions returns Options with sensible defaults for the given auth
// service base URL.
func DefaultOptions(authServiceURL string) Options {
	return Options{
		AuthServiceURL:      authServiceURL,
		JWKSURL:             authServiceURL + "/v1/jwks",
		VerifyAPIKeyURL:     authServiceURL + "/v1/verify-api-key",
		JWKSRefreshInterval: 5 * time.Minute,
		APIKeyCacheTTL:      30 * time.Second,
	}
}
