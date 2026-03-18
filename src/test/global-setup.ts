// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";

let serverProcess: ChildProcess;

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function setup() {
  const { rmSync, mkdirSync, writeFileSync } = await import("fs");

  // Delete old test database
  try { rmSync("data/passport.db", { force: true }); } catch {}
  mkdirSync("data", { recursive: true });

  const port = await getFreePort();
  writeFileSync("data/.test-port", String(port));

  // Run seed script first to create test data
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("bun", ["run", "src/seed.ts"], {
      env: {
        ...process.env,
        BETTER_AUTH_SECRET: "test-secret",
        ADMIN_PASSWORD: "test-admin-pass",
        ADMIN_EMAIL: "admin@workfort.dev",
      },
      stdio: "pipe",
    });
    let output = "";
    seed.stdout?.on("data", (d) => { output += d.toString(); });
    seed.stderr?.on("data", (d) => { output += d.toString(); });
    seed.on("close", (code) => {
      if (code === 0) {
        console.log("Seed output:", output);
        resolve();
      } else {
        reject(new Error(`Seed failed (exit ${code}): ${output}`));
      }
    });
  });

  // Start server on the free port
  serverProcess = spawn("bun", ["run", "src/index.ts"], {
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: "test-secret",
      PORT: String(port),
    },
    stdio: "pipe",
  });

  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server failed to start within 15 seconds");
}

export async function teardown() {
  serverProcess?.kill();
  const { rmSync } = await import("fs");
  try { rmSync("data/.test-port"); } catch {}
}
