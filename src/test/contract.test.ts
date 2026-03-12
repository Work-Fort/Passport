import { describe, it, expect } from "vitest";

const BASE = "http://localhost:3000";

describe("verify-api-key contract", () => {
  it("returns { valid: false, error: ... } for an invalid key", async () => {
    const res = await fetch(`${BASE}/api/auth/verify-api-key`, {
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

describe("health", () => {
  it("returns 200 with status ok", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

describe("JWKS", () => {
  it("returns a valid JWKS", async () => {
    const res = await fetch(`${BASE}/api/auth/jwks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toBeDefined();
    expect(Array.isArray(body.keys)).toBe(true);
  });
});
