package apikey

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Work-Fort/Passport/go/service-auth"
)

func testAPIKeyServer(t *testing.T, callCount *atomic.Int32) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/verify-api-key", func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)

		var body struct {
			Key string `json:"key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch body.Key {
		case "wf_valid_key":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"valid": true,
				"key": map[string]interface{}{
					"userId": "user-123",
					"metadata": map[string]interface{}{
						"username":     "kazw",
						"name":         "Kaz Walker",
						"display_name": "Kaz",
						"type":         "user",
					},
				},
			})
		case "wf-agent_valid":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"valid": true,
				"key": map[string]interface{}{
					"userId": "agent-456",
					"metadata": map[string]interface{}{
						"username":     "deploy-agent",
						"name":         "Deploy Agent",
						"display_name": "Deploy",
						"type":         "agent",
					},
				},
			})
		default:
			json.NewEncoder(w).Encode(map[string]interface{}{
				"valid": false,
				"error": "invalid api key",
			})
		}
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestValidator_ValidKey(t *testing.T) {
	var calls atomic.Int32
	srv := testAPIKeyServer(t, &calls)

	v := New(srv.URL+"/v1/verify-api-key", 1*time.Minute)

	id, err := v.Validate(context.Background(), "wf_valid_key")
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if id.ID != "user-123" {
		t.Errorf("ID: got %q", id.ID)
	}
	if id.Username != "kazw" {
		t.Errorf("Username: got %q", id.Username)
	}
	if id.Type != auth.TypeUser {
		t.Errorf("Type: got %q", id.Type)
	}
}

func TestValidator_InvalidKey(t *testing.T) {
	var calls atomic.Int32
	srv := testAPIKeyServer(t, &calls)

	v := New(srv.URL+"/v1/verify-api-key", 1*time.Minute)

	_, err := v.Validate(context.Background(), "wf_bogus")
	if err == nil {
		t.Fatal("expected error for invalid key")
	}
}

func TestValidator_CachesResult(t *testing.T) {
	var calls atomic.Int32
	srv := testAPIKeyServer(t, &calls)

	v := New(srv.URL+"/v1/verify-api-key", 1*time.Minute)

	// First call hits the server.
	id1, err := v.Validate(context.Background(), "wf_valid_key")
	if err != nil {
		t.Fatalf("first Validate: %v", err)
	}

	// Second call should be cached.
	id2, err := v.Validate(context.Background(), "wf_valid_key")
	if err != nil {
		t.Fatalf("second Validate: %v", err)
	}

	if calls.Load() != 1 {
		t.Errorf("expected 1 server call (cached), got %d", calls.Load())
	}
	if id2.ID != id1.ID {
		t.Errorf("cached ID mismatch: got %q, want %q", id2.ID, id1.ID)
	}
	if id2.Username != id1.Username {
		t.Errorf("cached Username mismatch: got %q, want %q", id2.Username, id1.Username)
	}
}

func TestValidator_CacheExpires(t *testing.T) {
	var calls atomic.Int32
	srv := testAPIKeyServer(t, &calls)

	v := New(srv.URL+"/v1/verify-api-key", 10*time.Millisecond)

	_, err := v.Validate(context.Background(), "wf_valid_key")
	if err != nil {
		t.Fatalf("first Validate: %v", err)
	}

	// Wait for cache to expire.
	time.Sleep(50 * time.Millisecond)

	_, err = v.Validate(context.Background(), "wf_valid_key")
	if err != nil {
		t.Fatalf("second Validate: %v", err)
	}

	if calls.Load() != 2 {
		t.Errorf("expected 2 server calls (cache expired), got %d", calls.Load())
	}
}

func TestValidator_AgentKey(t *testing.T) {
	var calls atomic.Int32
	srv := testAPIKeyServer(t, &calls)

	v := New(srv.URL+"/v1/verify-api-key", 1*time.Minute)

	id, err := v.Validate(context.Background(), "wf-agent_valid")
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if id.Type != auth.TypeAgent {
		t.Errorf("Type: got %q, want %q", id.Type, auth.TypeAgent)
	}
	if id.DisplayName != "Deploy" {
		t.Errorf("DisplayName: got %q", id.DisplayName)
	}
}
