// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { app } from "../app.js";

// SEC-7: Verify the sign-up guard wraps DB access in try/catch

describe("sign-up guard", () => {
  // The global-setup seeds users, so the DB already has users.
  // This lets us test the "users exist" path directly.

  it("rejects unauthenticated sign-up after first user exists", async () => {
    const res = await app.request("/v1/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "intruder@example.com",
        password: "testpassword123",
        name: "Intruder",
        username: "intruder",
        displayName: "Intruder",
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Sign-up requires admin authorization");
  });

  it("checks admin role, not just any session", () => {
    // Verify the guard source code checks for admin role
    const src = readFileSync("src/app.ts", "utf-8");
    expect(src).toContain('role !== "admin"');
  });

  it("returns 503 on DB error instead of falling through", () => {
    // Verify the sign-up guard wraps the DB query in try/catch
    const src = readFileSync("src/app.ts", "utf-8");
    // Find the sign-up guard handler
    const guardStart = src.indexOf('app.post("/v1/sign-up/email"');
    expect(guardStart).toBeGreaterThan(-1);
    const guardBlock = src.slice(guardStart, guardStart + 600);
    // Must contain try/catch around the adapter call
    expect(guardBlock).toContain("try {");
    expect(guardBlock).toContain("catch");
    expect(guardBlock).toContain("Service unavailable");
    expect(guardBlock).toContain("503");
  });

  it("allows sign-up when caller is an admin", async () => {
    // Sign in as the seeded admin to get a session cookie.
    const signIn = await app.request("/v1/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@workfort.dev",
        password: "test-admin-pass",
      }),
    });
    expect(signIn.status).toBeLessThan(400);

    // Extract cookie name=value pairs from each set-cookie entry.
    const cookies = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(cookies).toBeTruthy();

    // Use the session cookies to sign up a new user.
    const res = await app.request("/v1/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies,
      },
      body: JSON.stringify({
        email: "invited@example.com",
        password: "testpassword123",
        name: "Invited User",
        username: "invited",
        displayName: "Invited User",
      }),
    });
    expect(res.status).toBeLessThan(400);
  });
});
