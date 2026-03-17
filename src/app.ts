// SPDX-License-Identifier: Apache-2.0

import { Hono } from "hono";
import { auth } from "./auth.js";
import { verifyApiKeyRoute } from "./adapters/verify-api-key.js";

export const app = new Hono();

// Health check — public, outside auth
app.get("/health", (c) => c.json({ status: "ok" }));

// Service discovery — WorkFort BFF probes this to find the auth provider.
// 503 = no UI, but the manifest lets the BFF register this as "auth".
app.get("/ui/health", async (c) => {
  let setupMode = false;
  try {
    const ctx = await (auth as any).$context;
    const rows = await ctx.adapter.findMany({
      model: "user",
      limit: 1,
    });
    setupMode = !rows || rows.length === 0;
  } catch {
    // If the query fails (e.g., tables not yet created), assume setup mode.
    setupMode = true;
  }

  const body: Record<string, unknown> = {
    status: "ok",
    name: "auth",
    label: "Auth",
    route: "",
  };

  if (setupMode) {
    body.setup_mode = true;
  }

  return c.json(body, 503);
});

// Guard: sign-up is only open when no users exist (setup mode).
app.post("/v1/sign-up/email", async (c, next) => {
  let users;
  try {
    const ctx = await (auth as any).$context;
    users = await ctx.adapter.findMany({ model: "user", limit: 1 });
  } catch {
    return c.json({ error: "Service unavailable" }, 503);
  }

  if (users && users.length > 0) {
    // Users exist — require admin auth for sign-up.
    const session = await auth.api
      .getSession({ headers: c.req.raw.headers })
      .catch(() => null);
    if (!session || (session as any).user?.role !== "admin") {
      return c.json({ error: "Sign-up requires admin authorization" }, 403);
    }
  }

  // Setup mode (no users) or authenticated admin — allow through to Better Auth.
  return next();
});

// Adapter routes take priority (registered before the catch-all)
app.route("/", verifyApiKeyRoute);

// Better Auth handles everything else under /v1/*
app.on(["GET", "POST"], "/v1/*", (c) => {
  return auth.handler(c.req.raw);
});
