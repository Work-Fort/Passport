// SPDX-License-Identifier: Apache-2.0

import { serve } from "@hono/node-server";
import { app } from "./app.js";

export { app };

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
