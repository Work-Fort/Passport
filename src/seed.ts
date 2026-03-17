// SPDX-License-Identifier: Apache-2.0

import { auth } from "./auth.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@workfort.dev";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is required. Set it as an environment variable.");
  process.exit(1);
}

const SERVICES = [
  { username: "svc-sharkfin", name: "Sharkfin Service", type: "service" },
  { username: "svc-nexus", name: "Nexus Service", type: "service" },
  { username: "svc-hive", name: "Hive Service", type: "service" },
] as const;

// Helper: createUser may return { user: {...} } or the user directly
function extractUser(result: any): { id: string; email: string } {
  return result.user ?? result;
}

async function seed() {
  console.log("Seeding Passport...\n");

  // Run migrations to ensure the database schema exists
  const ctx = await (auth as any).$context;
  await ctx.runMigrations();
  console.log("Migrations complete.\n");

  // 1. Create admin user
  try {
    const result = await (auth.api as any).createUser({
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD!,
        name: "Admin",
        role: "admin",
        data: { username: "admin", displayName: "Admin", type: "user" },
      },
    });
    const user = extractUser(result);
    console.log(`Created admin user: ${user.email} (${user.id})`);
  } catch (err: any) {
    if (err?.message?.includes("already exists") || err?.status === 409) {
      console.log(`Admin user already exists, skipping.`);
    } else {
      throw err;
    }
  }

  // 2. Create service identities and API keys
  for (const svc of SERVICES) {
    let userId: string | undefined;

    try {
      const result = await (auth.api as any).createUser({
        body: {
          email: `${svc.username}@internal.workfort.dev`,
          password: crypto.randomUUID(),
          name: svc.name,
          data: {
            username: svc.username,
            displayName: svc.name,
            type: svc.type,
          },
        },
      });
      const user = extractUser(result);
      userId = user.id;
      console.log(`Created service: ${svc.username} (${userId})`);
    } catch (err: any) {
      if (err?.message?.includes("already exists") || err?.status === 409) {
        console.log(`Service ${svc.username} already exists, skipping.`);
        continue;
      }
      throw err;
    }

    // Create API key for the newly created service identity
    try {
      const key = await (auth.api as any).createApiKey({
        body: {
          userId: userId!,
          prefix: "wf-svc",
          name: svc.username,
          metadata: {
            username: svc.username,
            name: svc.name,
            display_name: svc.name,
            type: svc.type,
          },
        },
      });
      console.log(`  API key for ${svc.username}: ${key.key}`);
    } catch (err: any) {
      console.error(`  Failed to create API key for ${svc.username}:`, err?.message ?? err);
    }
  }

  console.log("\nSeed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
