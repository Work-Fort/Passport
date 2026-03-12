package auth

import "errors"

// Sentinel errors for authentication failures.
var (
	ErrNoToken      = errors.New("auth: missing Authorization header")
	ErrInvalidToken = errors.New("auth: invalid token")
)
