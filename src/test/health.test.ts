// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
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
  it("returns 503 with auth service manifest", async () => {
    const res = await app.request("/ui/health");
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.name).toBe("auth");
    expect(body.label).toBe("Auth");
    expect(body.route).toBe("");
  });
});
