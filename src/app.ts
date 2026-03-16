// SPDX-License-Identifier: Apache-2.0

import { Hono } from "hono";
import { auth } from "./auth.js";
import { verifyApiKeyRoute } from "./adapters/verify-api-key.js";

export const app = new Hono();

// Health check — public, outside auth
app.get("/health", (c) => c.json({ status: "ok" }));

// Service discovery — WorkFort BFF probes this to find the auth provider.
// 503 = no UI, but the manifest lets the BFF register this as "auth".
app.get("/ui/health", (c) => {
  return c.json(
    { status: "ok", name: "auth", label: "Auth", route: "" },
    503,
  );
});

// Adapter routes take priority (registered before the catch-all)
app.route("/", verifyApiKeyRoute);

// Better Auth handles everything else under /v1/*
app.on(["GET", "POST"], "/v1/*", (c) => {
  return auth.handler(c.req.raw);
});
