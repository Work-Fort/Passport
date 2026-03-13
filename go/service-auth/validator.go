// SPDX-License-Identifier: Apache-2.0

package auth

import "context"

// Validator validates a bearer token and returns the identity it represents.
// Implementations live in the infra adapter packages (jwt/, apikey/).
type Validator interface {
	Validate(ctx context.Context, token string) (Identity, error)
}
