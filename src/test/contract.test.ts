// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const port = readFileSync("data/.test-port", "utf-8").trim();
const BASE = `http://localhost:${port}`;

describe("health", () => {
  it("returns 200 with status ok", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

describe("GET /ui/health setup_mode", () => {
  it("omits setup_mode when users exist (DB was seeded)", async () => {
    const res = await fetch(`${BASE}/ui/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.name).toBe("auth");
    expect(body.admin_only).toBe(true);
    expect(body.setup_mode).toBeUndefined();
  });
});

describe("JWKS", () => {
  it("returns a valid JWKS", async () => {
    const res = await fetch(`${BASE}/v1/jwks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toBeDefined();
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys.length).toBeGreaterThan(0);
  });
});

describe("verify-api-key contract", () => {
  it("returns { valid: false, error: ... } for an invalid key", async () => {
    const res = await fetch(`${BASE}/v1/verify-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wf_nonexistent_key" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
  });
});

describe("JWT claims contract", () => {
  const testUser = {
    email: "test-jwt@workfort.dev",
    password: "test-password-123",
    name: "Test User",
    username: "testuser-jwt",
    displayName: "Tester",
  };

  let sessionCookie: string;
  let adminCookie: string;

  it("signs in as admin (needed for guarded sign-up)", async () => {
    const res = await fetch(`${BASE}/v1/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@workfort.dev",
        password: "test-admin-pass",
      }),
    });
    expect(res.status).toBeLessThan(400);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    adminCookie = setCookie!;
  });

  it("creates a user via sign-up (admin-authenticated)", async () => {
    const res = await fetch(`${BASE}/v1/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
        name: testUser.name,
        username: testUser.username,
        displayName: testUser.displayName,
      }),
    });
    expect(res.status).toBeLessThan(400);
  });

  it("signs in and gets a session cookie", async () => {
    const res = await fetch(`${BASE}/v1/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    });
    expect(res.status).toBeLessThan(400);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    sessionCookie = setCookie!;
  });

  it("GET /v1/token returns JWT with correct claims", async () => {
    const res = await fetch(`${BASE}/v1/token`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();

    // Decode JWT payload (no verification — just checking claim names)
    const payload = JSON.parse(
      Buffer.from(body.token.split(".")[1], "base64url").toString()
    );

    // These exact claim names are parsed by pkg/auth/jwt/jwt.go:77-96
    expect(payload.sub).toBeDefined();
    expect(payload.username).toBe(testUser.username);
    expect(payload.name).toBe(testUser.name);
    expect(payload.display_name).toBe(testUser.displayName);
    expect(payload.type).toBe("user"); // default type
  });
});
