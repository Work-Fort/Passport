package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

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
