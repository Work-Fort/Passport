// SPDX-License-Identifier: Apache-2.0

package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

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

// mockValidator is a test double implementing the Validator port.
type mockValidator struct {
	identity Identity
	err      error
}

func (m *mockValidator) Validate(_ context.Context, _ string) (Identity, error) {
	return m.identity, m.err
}

func TestMiddleware_ValidToken_FirstValidator(t *testing.T) {
	want := Identity{
		ID:          "user-1",
		Username:    "alice",
		Name:        "Alice Smith",
		DisplayName: "Alice",
		Type:        TypeUser,
	}

	mw := NewFromValidators(
		&mockValidator{identity: want, err: nil},
		&mockValidator{err: fmt.Errorf("should not be called")},
	)

	var gotIdentity Identity
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotIdentity = MustIdentity(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/v1/vms", nil)
	req.Header.Set("Authorization", "Bearer valid-jwt-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	if gotIdentity.ID != want.ID {
		t.Errorf("ID: got %q, want %q", gotIdentity.ID, want.ID)
	}
	if gotIdentity.Username != want.Username {
		t.Errorf("Username: got %q, want %q", gotIdentity.Username, want.Username)
	}
}

func TestMiddleware_FallbackToSecondValidator(t *testing.T) {
	want := Identity{
		ID:       "agent-1",
		Username: "deploy-bot",
		Type:     TypeAgent,
	}

	mw := NewFromValidators(
		&mockValidator{err: fmt.Errorf("not a JWT")},
		&mockValidator{identity: want, err: nil},
	)

	var gotIdentity Identity
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotIdentity = MustIdentity(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/v1/vms", nil)
	req.Header.Set("Authorization", "Bearer wf-agent_some_key")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	if gotIdentity.Type != TypeAgent {
		t.Errorf("Type: got %q, want %q", gotIdentity.Type, TypeAgent)
	}
}

func TestMiddleware_NoAuthHeader(t *testing.T) {
	mw := NewFromValidators(
		&mockValidator{err: fmt.Errorf("should not be called")},
	)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/v1/vms", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d, want 401", rec.Code)
	}

	var errBody map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&errBody); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if errBody["error"] != ErrNoToken.Error() {
		t.Errorf("error message: got %q, want %q", errBody["error"], ErrNoToken.Error())
	}
}

func TestMiddleware_AllValidatorsFail(t *testing.T) {
	mw := NewFromValidators(
		&mockValidator{err: fmt.Errorf("not a JWT")},
		&mockValidator{err: fmt.Errorf("invalid key")},
	)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/v1/vms", nil)
	req.Header.Set("Authorization", "Bearer totally-bogus-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d, want 401", rec.Code)
	}

	var errBody map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&errBody); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if errBody["error"] != ErrInvalidToken.Error() {
		t.Errorf("error message: got %q, want %q", errBody["error"], ErrInvalidToken.Error())
	}
}

func TestMiddleware_WebSocketUpgrade(t *testing.T) {
	want := Identity{
		ID:       "user-2",
		Username: "bob",
		Type:     TypeUser,
	}

	mw := NewFromValidators(
		&mockValidator{identity: want, err: nil},
	)

	var gotIdentity Identity
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotIdentity = MustIdentity(r.Context())
		w.WriteHeader(http.StatusSwitchingProtocols)
	}))

	// Simulate a WebSocket upgrade request with Bearer token.
	req := httptest.NewRequest("GET", "/ws", nil)
	req.Header.Set("Authorization", "Bearer valid-jwt-token")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusSwitchingProtocols {
		t.Fatalf("status: got %d, want 101", rec.Code)
	}
	if gotIdentity.ID != want.ID {
		t.Errorf("ID: got %q, want %q", gotIdentity.ID, want.ID)
	}
}

// extractBearer is case-sensitive per implementation.
// This test documents that behavior.
func TestMiddleware_BearerCaseSensitive(t *testing.T) {
	mw := NewFromValidators(
		&mockValidator{identity: Identity{ID: "user-1"}, err: nil},
	)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called for lowercase bearer")
	}))

	req := httptest.NewRequest("GET", "/v1/vms", nil)
	req.Header.Set("Authorization", "bearer lowercase-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("lowercase 'bearer' should be rejected: got %d, want 401", rec.Code)
	}
}

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
