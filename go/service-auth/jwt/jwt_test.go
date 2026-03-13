// SPDX-License-Identifier: Apache-2.0

package jwt

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Work-Fort/Passport/go/service-auth"

	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	jwtlib "github.com/lestrrat-go/jwx/v2/jwt"
)

// testKeyServer creates a test JWKS server and returns the server and the private key for signing.
func testKeyServer(t *testing.T) (*httptest.Server, jwk.Key) {
	t.Helper()

	raw, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	privKey, err := jwk.FromRaw(raw)
	if err != nil {
		t.Fatalf("jwk from raw: %v", err)
	}
	if err := privKey.Set(jwk.KeyIDKey, "test-key-1"); err != nil {
		t.Fatalf("set kid: %v", err)
	}
	if err := privKey.Set(jwk.AlgorithmKey, jwa.ES256); err != nil {
		t.Fatalf("set alg: %v", err)
	}

	pubKey, err := privKey.PublicKey()
	if err != nil {
		t.Fatalf("public key: %v", err)
	}

	pubSet := jwk.NewSet()
	if err := pubSet.AddKey(pubKey); err != nil {
		t.Fatalf("add key: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(pubSet)
	}))
	t.Cleanup(srv.Close)

	return srv, privKey
}

func signTestToken(t *testing.T, key jwk.Key, claims map[string]interface{}, exp time.Time) []byte {
	t.Helper()

	tok, err := jwtlib.NewBuilder().
		Subject(claims["sub"].(string)).
		Expiration(exp).
		Build()
	if err != nil {
		t.Fatalf("build token: %v", err)
	}

	for k, v := range claims {
		if k == "sub" {
			continue // already set
		}
		if err := tok.Set(k, v); err != nil {
			t.Fatalf("set claim %s: %v", k, err)
		}
	}

	signed, err := jwtlib.Sign(tok, jwtlib.WithKey(jwa.ES256, key))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func TestValidator_ValidToken(t *testing.T) {
	srv, privKey := testKeyServer(t)

	v, err := New(context.Background(), srv.URL, 15*time.Minute)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer v.Close()

	token := signTestToken(t, privKey, map[string]interface{}{
		"sub":          "550e8400-e29b-41d4-a716-446655440000",
		"username":     "kazw",
		"name":         "Kaz Walker",
		"display_name": "Kaz",
		"type":         "user",
	}, time.Now().Add(15*time.Minute))

	id, err := v.Validate(context.Background(), string(token))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if id.ID != "550e8400-e29b-41d4-a716-446655440000" {
		t.Errorf("ID: got %q", id.ID)
	}
	if id.Username != "kazw" {
		t.Errorf("Username: got %q", id.Username)
	}
	if id.Name != "Kaz Walker" {
		t.Errorf("Name: got %q", id.Name)
	}
	if id.DisplayName != "Kaz" {
		t.Errorf("DisplayName: got %q", id.DisplayName)
	}
	if id.Type != auth.TypeUser {
		t.Errorf("Type: got %q", id.Type)
	}
}

func TestValidator_ExpiredToken(t *testing.T) {
	srv, privKey := testKeyServer(t)

	v, err := New(context.Background(), srv.URL, 15*time.Minute)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer v.Close()

	token := signTestToken(t, privKey, map[string]interface{}{
		"sub":      "test-id",
		"username": "testuser",
		"type":     "user",
	}, time.Now().Add(-15*time.Minute)) // expired

	_, err = v.Validate(context.Background(), string(token))
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestValidator_InvalidSignature(t *testing.T) {
	srv, _ := testKeyServer(t)

	v, err := New(context.Background(), srv.URL, 15*time.Minute)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer v.Close()

	// Sign with a different key
	otherRaw, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	otherKey, _ := jwk.FromRaw(otherRaw)
	_ = otherKey.Set(jwk.KeyIDKey, "wrong-key")
	_ = otherKey.Set(jwk.AlgorithmKey, jwa.ES256)

	token := signTestToken(t, otherKey, map[string]interface{}{
		"sub":      "test-id",
		"username": "testuser",
		"type":     "user",
	}, time.Now().Add(15*time.Minute))

	_, err = v.Validate(context.Background(), string(token))
	if err == nil {
		t.Fatal("expected error for invalid signature")
	}
}
