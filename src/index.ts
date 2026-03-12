import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { auth } from "./auth.js";
import { verifyApiKeyRoute } from "./adapters/verify-api-key.js";

const app = new Hono();

// Health check — public, outside auth
app.get("/health", (c) => c.json({ status: "ok" }));

// Adapter routes take priority (registered before the catch-all)
app.route("/", verifyApiKeyRoute);

// Better Auth handles everything else under /api/auth/*
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

const port = parseInt(process.env.PORT ?? "3000", 10);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Passport listening on :${info.port}`);
});
