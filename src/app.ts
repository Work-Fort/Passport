// SPDX-License-Identifier: Apache-2.0

import { Hono } from "hono";
import { auth } from "./auth.js";
import { verifyApiKeyRoute } from "./adapters/verify-api-key.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const app = new Hono();

// Health check — public, outside auth
app.get("/health", (c) => c.json({ status: "ok" }));

// Service discovery — WorkFort BFF probes this to find the auth provider.
// Must be before /ui/* static handler.
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
    display: "menu",
  };

  if (setupMode) {
    body.setup_mode = true;
  }

  return c.json(body, 200);
});

// Static assets — admin UI (Module Federation remote)
// Must be after /ui/health to avoid catching it.
const MIME: Record<string, string> = {
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  html: "text/html",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
};

app.get("/ui/*", (c) => {
  const filePath = c.req.path.replace("/ui/", "") || "index.html";
  const fullPath = join(process.cwd(), "web", "dist", filePath);
  if (!existsSync(fullPath)) return c.notFound();
  const content = readFileSync(fullPath);
  const ext = fullPath.split(".").pop() || "";
  return c.body(content, {
    headers: { "content-type": MIME[ext] || "application/octet-stream" },
  });
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

  // Setup mode — first user gets auto-promoted to admin after creation.
  const isSetupMode = !users || users.length === 0;

  await next();

  if (isSetupMode) {
    // The user was just created by Better Auth. Find them and promote to admin.
    try {
      const ctx = await (auth as any).$context;
      const allUsers = await ctx.adapter.findMany({ model: "user", limit: 1 });
      if (allUsers && allUsers.length === 1) {
        await ctx.adapter.update({
          model: "user",
          where: [{ field: "id", value: allUsers[0].id }],
          update: { role: "admin" },
        });
      }
    } catch (e) {
      // Non-fatal — user created but not promoted. Can be fixed manually.
      console.error("Failed to auto-promote first user to admin:", e);
    }
  }
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
