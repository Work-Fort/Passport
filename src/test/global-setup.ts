import { spawn, type ChildProcess } from "child_process";

let serverProcess: ChildProcess;

export async function setup() {
  // Delete old test database
  const { rmSync, mkdirSync } = await import("fs");
  try { rmSync("data/passport.db", { force: true }); } catch {}
  mkdirSync("data", { recursive: true });

  // Run seed script first to create test data
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("node", ["--import", "tsx", "src/seed.ts"], {
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

  // Start server
  serverProcess = spawn("node", ["--import", "tsx", "src/index.ts"], {
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: "test-secret",
      PORT: "3000",
    },
    stdio: "pipe",
  });

  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://localhost:3000/health");
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server failed to start within 15 seconds");
}

export async function teardown() {
  serverProcess?.kill();
}
