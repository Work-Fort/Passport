// SPDX-License-Identifier: Apache-2.0

package apikey

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/Work-Fort/Passport/go/service-auth"
)

// Compile-time interface check.
var _ auth.Validator = (*Validator)(nil)

// Validator validates API keys by calling the auth service's verify endpoint.
// Successful results are cached for the configured TTL — a revoked key remains
// valid for up to that duration (default 30s, per spec).
type Validator struct {
	verifyURL string
	cacheTTL  time.Duration
	client    *http.Client

	mu    sync.RWMutex
	cache map[string]cachedKey
}

type cachedKey struct {
	identity auth.Identity
	validAt  time.Time
}

// New creates an API key validator that verifies keys against the given URL.
// The verifyURL should be the full endpoint (e.g., "http://127.0.0.1:3000/v1/verify-api-key").
func New(verifyURL string, cacheTTL time.Duration) *Validator {
	return &Validator{
		verifyURL: verifyURL,
		cacheTTL:  cacheTTL,
		client:    &http.Client{Timeout: 5 * time.Second},
		cache:     make(map[string]cachedKey),
	}
}

// Validate checks an API key against the auth service. Results are cached
// for the configured TTL.
func (v *Validator) Validate(ctx context.Context, key string) (auth.Identity, error) {
	// Check cache first.
	if id, ok := v.fromCache(key); ok {
		return id, nil
	}

	// Call auth service.
	body, err := json.Marshal(map[string]string{"key": key})
	if err != nil {
		return auth.Identity{}, fmt.Errorf("apikey: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.verifyURL, bytes.NewReader(body))
	if err != nil {
		return auth.Identity{}, fmt.Errorf("apikey: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := v.client.Do(req)
	if err != nil {
		return auth.Identity{}, fmt.Errorf("apikey: verify: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return auth.Identity{}, fmt.Errorf("apikey: verify: HTTP %d", resp.StatusCode)
	}

	var result struct {
		Valid bool `json:"valid"`
		Key   *struct {
			UserID   string                 `json:"userId"`
			Metadata map[string]interface{} `json:"metadata"`
		} `json:"key,omitempty"`
		Error string `json:"error,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return auth.Identity{}, fmt.Errorf("apikey: decode response: %w", err)
	}

	if !result.Valid || result.Key == nil {
		return auth.Identity{}, fmt.Errorf("apikey: invalid key")
	}

	id := auth.Identity{ID: result.Key.UserID}
	if m := result.Key.Metadata; m != nil {
		id.Username, _ = m["username"].(string)
		id.Name, _ = m["name"].(string)
		id.DisplayName, _ = m["display_name"].(string)
		id.Type, _ = m["type"].(string)
	}

	// Cache the result.
	v.toCache(key, id)

	return id, nil
}

func (v *Validator) fromCache(key string) (auth.Identity, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	cached, ok := v.cache[key]
	if !ok || time.Since(cached.validAt) >= v.cacheTTL {
		return auth.Identity{}, false
	}
	return cached.identity, true
}

func (v *Validator) toCache(key string, id auth.Identity) {
	v.mu.Lock()
	defer v.mu.Unlock()

	// Lazy eviction: remove expired entries when cache grows beyond 1000 entries.
	if len(v.cache) > 1000 {
		now := time.Now()
		for k, c := range v.cache {
			if now.Sub(c.validAt) >= v.cacheTTL {
				delete(v.cache, k)
			}
		}
	}

	v.cache[key] = cachedKey{identity: id, validAt: time.Now()}
}
