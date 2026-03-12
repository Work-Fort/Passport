package jwt

import (
	"context"
	"fmt"
	"time"

	"github.com/Work-Fort/Passport/go/service-auth"

	"github.com/lestrrat-go/jwx/v2/jwk"
	jwtlib "github.com/lestrrat-go/jwx/v2/jwt"
)

// Compile-time interface check.
var _ auth.Validator = (*Validator)(nil)

// Validator validates JWTs against a JWKS endpoint with auto-refresh.
type Validator struct {
	keyCache *jwk.Cache
	jwksURL  string
	cancel   context.CancelFunc
}

// New creates a JWT validator that fetches and caches public keys from the given
// JWKS URL. It performs an initial fetch to fail fast if the endpoint is unreachable.
// The provided context controls the lifetime of the background JWKS refresh goroutine;
// call Close() to stop it.
func New(ctx context.Context, jwksURL string, refreshInterval time.Duration) (*Validator, error) {
	cacheCtx, cancel := context.WithCancel(ctx)

	cache := jwk.NewCache(cacheCtx)

	err := cache.Register(jwksURL, jwk.WithRefreshInterval(refreshInterval))
	if err != nil {
		cancel()
		return nil, fmt.Errorf("jwt: register JWKS URL: %w", err)
	}

	// Perform initial fetch to fail fast if the JWKS endpoint is unreachable.
	_, err = cache.Refresh(cacheCtx, jwksURL)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("jwt: initial JWKS fetch from %s: %w", jwksURL, err)
	}

	return &Validator{
		keyCache: cache,
		jwksURL:  jwksURL,
		cancel:   cancel,
	}, nil
}

// Close stops the background JWKS refresh goroutine.
func (v *Validator) Close() {
	v.cancel()
}

// Validate parses and validates a JWT string against the cached JWKS keys.
// Returns the Identity encoded in the token's claims.
func (v *Validator) Validate(ctx context.Context, tokenStr string) (auth.Identity, error) {
	keySet, err := v.keyCache.Get(ctx, v.jwksURL)
	if err != nil {
		return auth.Identity{}, fmt.Errorf("jwt: fetch JWKS: %w", err)
	}

	tok, err := jwtlib.Parse([]byte(tokenStr),
		jwtlib.WithKeySet(keySet),
		jwtlib.WithValidate(true),
	)
	if err != nil {
		return auth.Identity{}, fmt.Errorf("jwt: parse/validate: %w", err)
	}

	return identityFromToken(tok), nil
}

func identityFromToken(tok jwtlib.Token) auth.Identity {
	id := auth.Identity{
		ID: tok.Subject(),
	}

	if v, ok := tok.Get("username"); ok {
		id.Username, _ = v.(string)
	}
	if v, ok := tok.Get("name"); ok {
		id.Name, _ = v.(string)
	}
	if v, ok := tok.Get("display_name"); ok {
		id.DisplayName, _ = v.(string)
	}
	if v, ok := tok.Get("type"); ok {
		id.Type, _ = v.(string)
	}

	return id
}
