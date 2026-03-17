// SPDX-License-Identifier: Apache-2.0

import { Hono } from "hono";
import { auth } from "../auth.js";

export const verifyApiKeyRoute = new Hono();

// Type helper: better-auth's generic inference does not surface plugin-added
// endpoints on `auth.api` at the TypeScript level, but they are present at
// runtime. We cast through `unknown` to keep TypeScript satisfied while
// preserving the correct runtime behaviour.
type VerifyApiKeyResult =
  | { valid: false; error: { message: string; code: string }; key: null }
  | {
      valid: true;
      error: null;
      key: {
        referenceId: string;
        metadata: Record<string, unknown> | null;
        [k: string]: unknown;
      } | null;
    };

type AuthApiWithPlugin = typeof auth.api & {
  verifyApiKey(opts: {
    body: { key: string; configId?: string };
  }): Promise<VerifyApiKeyResult>;
};

const authApi = auth.api as AuthApiWithPlugin;

verifyApiKeyRoute.post("/v1/verify-api-key", async (c) => {
  let apiKey: string;
  try {
    const body = await c.req.json();
    apiKey = body.key;
  } catch {
    return c.json({ valid: false, error: "invalid request body" }, 400);
  }

  if (!apiKey || typeof apiKey !== "string") {
    return c.json({ valid: false, error: "missing key" }, 400);
  }

  try {
    const result = await authApi.verifyApiKey({ body: { key: apiKey } });

    if (!result || !result.valid || !result.key) {
      return c.json({ valid: false, error: "invalid api key" });
    }

    // The @better-auth/api-key plugin stores the owner's user ID in
    // `referenceId`. Reshape to match the Go middleware contract which
    // expects the field name `userId`.
    return c.json({
      valid: true,
      key: {
        userId: result.key.referenceId,
        metadata: result.key.metadata ?? {},
      },
    });
  } catch (err: unknown) {
    // Distinguish "key not found" from internal errors.
    const e = err as {
      status?: number;
      code?: string;
      body?: { code?: string };
    };
    if (
      e?.status === 404 ||
      e?.code === "KEY_NOT_FOUND" ||
      e?.body?.code === "KEY_NOT_FOUND"
    ) {
      return c.json({ valid: false, error: "invalid api key" });
    }
    console.error("verify-api-key internal error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "internal server error" }, 500);
  }
});
