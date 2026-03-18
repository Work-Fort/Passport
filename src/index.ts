// SPDX-License-Identifier: Apache-2.0

import { auth } from "./auth.js";
import { app } from "./app.js";

export { app };

if (!process.env.BETTER_AUTH_SECRET) {
  console.error("BETTER_AUTH_SECRET is required. Set it as an environment variable.");
  console.error("Generate one with: openssl rand -base64 32");
  process.exit(1);
}

// Run database migrations before accepting requests.
const ctx = await (auth as any).$context;
await ctx.runMigrations();

const hostname = process.env.HOST ?? "0.0.0.0";
const port = parseInt(process.env.PORT ?? "3000", 10);
const server = Bun.serve({ fetch: app.fetch, hostname, port });
console.log(`Passport listening on ${hostname}:${server.port}`);

// Graceful shutdown — Bun as PID 1 ignores signals without explicit handlers.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`Received ${sig}, shutting down...`);
    server.stop().then(() => process.exit(0));
  });
}
