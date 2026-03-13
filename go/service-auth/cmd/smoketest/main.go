package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"time"

	auth "github.com/Work-Fort/Passport/go/service-auth"
	"github.com/Work-Fort/Passport/go/service-auth/apikey"
	"github.com/Work-Fort/Passport/go/service-auth/jwt"
)

func main() {
	passportURL := os.Getenv("PASSPORT_URL")
	if passportURL == "" {
		passportURL = "http://passport.nexus:3000"
	}

	svcAPIKey := os.Getenv("SERVICE_API_KEY")
	if svcAPIKey == "" {
		log.Fatal("SERVICE_API_KEY is required")
	}

	ctx := context.Background()
	opts := auth.DefaultOptions(passportURL)
	var failed int

	// --- Test 1: Health check ---
	fmt.Println("=== Test 1: Health check ===")
	resp, err := http.Get(passportURL + "/health")
	if err != nil {
		log.Fatalf("FAIL: health check: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		fmt.Printf("FAIL: health check returned %d\n", resp.StatusCode)
		failed++
	} else {
		fmt.Printf("PASS: %s\n", string(body))
	}

	// --- Test 2: JWKS endpoint ---
	fmt.Println("\n=== Test 2: JWKS endpoint ===")
	resp, err = http.Get(opts.JWKSURL)
	if err != nil {
		log.Fatalf("FAIL: JWKS fetch: %v", err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	var jwks map[string]interface{}
	if err := json.Unmarshal(body, &jwks); err != nil {
		fmt.Printf("FAIL: JWKS parse: %v\n", err)
		failed++
	} else if keys, ok := jwks["keys"].([]interface{}); !ok || len(keys) == 0 {
		fmt.Printf("FAIL: JWKS has no keys\n")
		failed++
	} else {
		fmt.Printf("PASS: JWKS has %d key(s)\n", len(keys))
	}

	// --- Test 3: JWT validator initialization ---
	fmt.Println("\n=== Test 3: JWT validator ===")
	jwtV, err := jwt.New(ctx, opts.JWKSURL, 20*time.Minute)
	if err != nil {
		fmt.Printf("FAIL: JWT validator init: %v\n", err)
		failed++
	} else {
		fmt.Println("PASS: JWT validator initialized (JWKS fetched)")
		defer jwtV.Close()
	}

	// --- Test 4: API key validation ---
	fmt.Println("\n=== Test 4: API key validation ===")
	akV := apikey.New(opts.VerifyAPIKeyURL, opts.APIKeyCacheTTL)
	id, err := akV.Validate(ctx, svcAPIKey)
	if err != nil {
		fmt.Printf("FAIL: API key validation: %v\n", err)
		failed++
	} else {
		fmt.Printf("PASS: Validated API key\n")
		fmt.Printf("  ID:          %s\n", id.ID)
		fmt.Printf("  Username:    %s\n", id.Username)
		fmt.Printf("  Name:        %s\n", id.Name)
		fmt.Printf("  DisplayName: %s\n", id.DisplayName)
		fmt.Printf("  Type:        %s\n", id.Type)
		if id.Type != auth.TypeService {
			fmt.Printf("FAIL: expected type %q, got %q\n", auth.TypeService, id.Type)
			failed++
		}
	}

	// --- Test 5: API key validation (invalid key) ---
	fmt.Println("\n=== Test 5: Invalid API key ===")
	_, err = akV.Validate(ctx, "wf-svc_bogus_key_that_does_not_exist")
	if err == nil {
		fmt.Println("FAIL: expected error for invalid key, got nil")
		failed++
	} else {
		fmt.Printf("PASS: invalid key rejected: %v\n", err)
	}

	// --- Test 6: Sign up, sign in, get JWT, validate through middleware ---
	fmt.Println("\n=== Test 6: Full JWT flow ===")
	testUser := fmt.Sprintf("smoketest-%d", time.Now().UnixMilli())
	testEmail := testUser + "@test.workfort.dev"
	testPassword := "Test1234!@#$"

	// Sign up
	signupBody, _ := json.Marshal(map[string]string{
		"email":       testEmail,
		"password":    testPassword,
		"name":        "Smoke Test",
		"username":    testUser,
		"displayName": "Smoke Test",
	})
	resp, err = http.Post(passportURL+"/v1/sign-up/email", "application/json", bytes.NewReader(signupBody))
	if err != nil {
		fmt.Printf("FAIL: sign up: %v\n", err)
		failed++
	} else {
		body, _ = io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			fmt.Printf("FAIL: sign up returned %d: %s\n", resp.StatusCode, string(body))
			failed++
		} else {
			fmt.Printf("PASS: signed up %s\n", testEmail)
		}
	}

	// Sign in to get session cookie
	signinBody, _ := json.Marshal(map[string]string{
		"email":    testEmail,
		"password": testPassword,
	})
	client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	signinReq, _ := http.NewRequest("POST", passportURL+"/v1/sign-in/email", bytes.NewReader(signinBody))
	signinReq.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(signinReq)
	if err != nil {
		fmt.Printf("FAIL: sign in: %v\n", err)
		failed++
	} else {
		body, _ = io.ReadAll(resp.Body)
		resp.Body.Close()

		// Extract session cookie
		var sessionCookie string
		for _, c := range resp.Cookies() {
			if strings.HasPrefix(c.Name, "better-auth") {
				sessionCookie = c.Name + "=" + c.Value
				break
			}
		}
		if sessionCookie == "" {
			fmt.Printf("FAIL: no session cookie in sign-in response (status %d): %s\n", resp.StatusCode, string(body))
			failed++
		} else {
			fmt.Printf("PASS: signed in, got session cookie\n")

			// Get JWT token
			tokenReq, _ := http.NewRequest("GET", passportURL+"/v1/token", nil)
			tokenReq.Header.Set("Cookie", sessionCookie)
			resp, err = client.Do(tokenReq)
			if err != nil {
				fmt.Printf("FAIL: get token: %v\n", err)
				failed++
			} else {
				body, _ = io.ReadAll(resp.Body)
				resp.Body.Close()
				var tokenResp map[string]interface{}
				json.Unmarshal(body, &tokenResp)
				jwtToken, _ := tokenResp["token"].(string)
				if jwtToken == "" {
					fmt.Printf("FAIL: no token in response: %s\n", string(body))
					failed++
				} else {
					fmt.Printf("PASS: got JWT token (%d chars)\n", len(jwtToken))

					// Validate JWT through the validator
					if jwtV != nil {
						id, err := jwtV.Validate(ctx, jwtToken)
						if err != nil {
							fmt.Printf("FAIL: JWT validation: %v\n", err)
							failed++
						} else {
							fmt.Printf("PASS: JWT validated\n")
							fmt.Printf("  ID:          %s\n", id.ID)
							fmt.Printf("  Username:    %s\n", id.Username)
							fmt.Printf("  Name:        %s\n", id.Name)
							fmt.Printf("  Type:        %s\n", id.Type)
						}
					}

					// --- Test 7: Middleware integration ---
					fmt.Println("\n=== Test 7: Middleware integration ===")
					mw := auth.NewFromValidators(jwtV, akV)
					handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						id := auth.MustIdentity(r.Context())
						json.NewEncoder(w).Encode(map[string]string{
							"id":       id.ID,
							"username": id.Username,
							"type":     id.Type,
						})
					}))

					// Test with JWT
					req := httptest.NewRequest("GET", "/v1/protected", nil)
					req.Header.Set("Authorization", "Bearer "+jwtToken)
					rec := httptest.NewRecorder()
					handler.ServeHTTP(rec, req)
					if rec.Code != 200 {
						fmt.Printf("FAIL: middleware with JWT returned %d: %s\n", rec.Code, rec.Body.String())
						failed++
					} else {
						fmt.Printf("PASS: middleware accepted JWT: %s", rec.Body.String())
					}

					// Test with API key
					req = httptest.NewRequest("GET", "/v1/protected", nil)
					req.Header.Set("Authorization", "Bearer "+svcAPIKey)
					rec = httptest.NewRecorder()
					handler.ServeHTTP(rec, req)
					if rec.Code != 200 {
						fmt.Printf("FAIL: middleware with API key returned %d: %s\n", rec.Code, rec.Body.String())
						failed++
					} else {
						fmt.Printf("PASS: middleware accepted API key: %s", rec.Body.String())
					}

					// Test with no auth
					req = httptest.NewRequest("GET", "/v1/protected", nil)
					rec = httptest.NewRecorder()
					handler.ServeHTTP(rec, req)
					if rec.Code != 401 {
						fmt.Printf("FAIL: middleware without auth returned %d, expected 401\n", rec.Code)
						failed++
					} else {
						fmt.Printf("PASS: middleware rejected unauthenticated request: %s", rec.Body.String())
					}

					// Test with bogus token
					req = httptest.NewRequest("GET", "/v1/protected", nil)
					req.Header.Set("Authorization", "Bearer totally-invalid-token")
					rec = httptest.NewRecorder()
					handler.ServeHTTP(rec, req)
					if rec.Code != 401 {
						fmt.Printf("FAIL: middleware with bad token returned %d, expected 401\n", rec.Code)
						failed++
					} else {
						fmt.Printf("PASS: middleware rejected invalid token: %s", rec.Body.String())
					}
				}
			}
		}
	}

	// --- Summary ---
	fmt.Println("\n=== Summary ===")
	if failed > 0 {
		fmt.Printf("%d test(s) FAILED\n", failed)
		os.Exit(1)
	}
	fmt.Println("All tests PASSED")
}
