// SPDX-License-Identifier: Apache-2.0

package auth

import "context"

type contextKey struct{}

// ContextWithIdentity returns a new context with the given Identity stored in it.
func ContextWithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

// IdentityFromContext extracts the verified Identity from the context.
// Returns the identity and true if present, or a zero Identity and false if not.
func IdentityFromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(contextKey{}).(Identity)
	return id, ok
}

// MustIdentity extracts the Identity from the context or panics.
// Use only in handlers that are guaranteed to be behind the auth middleware.
func MustIdentity(ctx context.Context) Identity {
	id, ok := IdentityFromContext(ctx)
	if !ok {
		panic("auth: no identity in context — handler not behind auth middleware")
	}
	return id
}
