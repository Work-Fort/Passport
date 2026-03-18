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
    label: "Admin",
    route: "/admin",
    admin_only: true,
  };

  if (setupMode) {
    body.setup_mode = true;
  }

  return c.json(body, 200);
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

// Guard: prevent removing the last admin user.
app.post("/v1/admin/remove-user", async (c, next) => {
  const body = await c.req.json();
  const userId = body?.userId;
  if (!userId) return next();

  const ctx = await (auth as any).$context;
  const user = await ctx.adapter.findOne({
    model: "user",
    where: [{ field: "id", value: userId }],
  });

  if (user?.role === "admin") {
    const admins = await ctx.adapter.findMany({
      model: "user",
      where: [{ field: "role", value: "admin" }],
    });
    if (!admins || admins.length <= 1) {
      return c.json({ error: "Cannot remove the last admin" }, 400);
    }
  }

  return next();
});

// Guard: prevent demoting the last admin user.
app.post("/v1/admin/set-role", async (c, next) => {
  const body = await c.req.json();
  const userId = body?.userId;
  const newRole = body?.role;

  if (!userId || newRole === "admin") return next();

  const ctx = await (auth as any).$context;
  const user = await ctx.adapter.findOne({
    model: "user",
    where: [{ field: "id", value: userId }],
  });

  if (user?.role === "admin") {
    const admins = await ctx.adapter.findMany({
      model: "user",
      where: [{ field: "role", value: "admin" }],
    });
    if (!admins || admins.length <= 1) {
      return c.json({ error: "Cannot demote the last admin" }, 400);
    }
  }

  return next();
});

// Admin-only: list all API keys (Better Auth only returns per-user keys).
app.get("/v1/admin/api-keys", async (c) => {
  const session = await auth.api
    .getSession({ headers: c.req.raw.headers })
    .catch(() => null);
  if (!session || (session as any).user?.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const ctx = await (auth as any).$context;
  const keys = await ctx.adapter.findMany({ model: "apikey" });

  const sanitized = (keys || []).map((k: any) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    userId: k.userId,
    metadata: k.metadata,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    enabled: k.enabled,
  }));

  return c.json({ keys: sanitized });
});

// Better Auth handles everything else under /v1/*
app.on(["GET", "POST"], "/v1/*", (c) => {
  return auth.handler(c.req.raw);
});
