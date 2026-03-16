// SPDX-License-Identifier: Apache-2.0

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { auth } from "./auth.js";
import { verifyApiKeyRoute } from "./adapters/verify-api-key.js";

const app = new Hono();

// Health check — public, outside auth
app.get("/health", (c) => c.json({ status: "ok" }));

// Adapter routes take priority (registered before the catch-all)
app.route("/", verifyApiKeyRoute);

// Better Auth handles everything else under /v1/*
app.on(["GET", "POST"], "/v1/*", (c) => {
  return auth.handler(c.req.raw);
});

const hostname = process.env.HOST ?? "0.0.0.0";
const port = parseInt(process.env.PORT ?? "3000", 10);
const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
  console.log(`Passport listening on ${hostname}:${info.port}`);
});

// Graceful shutdown — Node as PID 1 ignores signals without explicit handlers.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`Received ${sig}, shutting down...`);
    server.close(() => process.exit(0));
  });
}
