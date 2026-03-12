import { Hono } from "hono";

export const verifyApiKeyRoute = new Hono();

// TODO: implement in Task 4
verifyApiKeyRoute.post("/api/auth/verify-api-key", async (c) => {
  return c.json({ error: "not implemented" }, 501);
});
