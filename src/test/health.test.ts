// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { app } from "../app.js";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

describe("GET /ui/health", () => {
  it("returns 200 with admin service manifest", async () => {
    const res = await app.request("/ui/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.name).toBe("auth");
    expect(body.label).toBe("Admin");
    expect(body.route).toBe("/admin");
    expect(body.admin_only).toBe(true);
  });

  it("omits setup_mode when users exist (DB was seeded by global-setup)", async () => {
    const res = await app.request("/ui/health");
    const body = await res.json();
    expect(body.setup_mode).toBeUndefined();
  });
});

describe("verify-api-key error sanitization", () => {
  it("does not log raw error objects", () => {
    const src = readFileSync("src/adapters/verify-api-key.ts", "utf-8");
    // Should NOT contain the old pattern that logs the raw err object
    expect(src).not.toMatch(/console\.error\([^)]*,\s*err\s*\)/);
    // Should contain sanitized logging
    expect(src).toContain("err instanceof Error ? err.message : String(err)");
  });
});

describe("BETTER_AUTH_SECRET startup guard", () => {
  it("has BETTER_AUTH_SECRET set in the test environment", () => {
    expect(process.env.BETTER_AUTH_SECRET).toBe("test-secret");
  });

  it("src/index.ts contains the BETTER_AUTH_SECRET guard before serve()", () => {
    const src = readFileSync("src/index.ts", "utf-8");
    // The guard must appear before the serve() call
    const guardIndex = src.indexOf("if (!process.env.BETTER_AUTH_SECRET)");
    const serveIndex = src.indexOf("serve(");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(serveIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(serveIndex);
  });
});
