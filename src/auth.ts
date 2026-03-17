// SPDX-License-Identifier: Apache-2.0

import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { jwt, bearer, admin, organization } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import Database, { type Database as SQLiteDatabase } from "better-sqlite3";
import { Pool } from "pg";

const databaseURL = process.env.DATABASE_URL ?? "./data/passport.db";

function isPostgres(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function createDatabase(url: string): Pool | SQLiteDatabase {
  if (isPostgres(url)) {
    return new Pool({ connectionString: url });
  }
  return new Database(url);
}

const sessionMaxAge = parseInt(process.env.SESSION_MAX_AGE ?? "1209600", 10);

const trustedOrigins = process.env.TRUSTED_ORIGINS
  ? process.env.TRUSTED_ORIGINS.split(",").map((s) => s.trim())
  : [];

const plugins: BetterAuthPlugin[] = [
  jwt({
    jwt: {
      expirationTime: "15m", // 15 minutes — matches BFF proxy cache cadence
      definePayload: async ({ user }) => ({
        sub: user.id,
        username: user.username as string,
        name: user.name,
        display_name: user.displayName as string,
        type: (user.type as string) ?? "user",
      }),
    },
  }),
  bearer(),
  apiKey({ enableMetadata: true }),
  admin(),
  organization(),
];

if (process.env.GITHUB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) {
  plugins.push(deviceAuthorization({ verificationUri: "/device" }));
}

const socialProviders: Record<string, any> = {};
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  database: createDatabase(databaseURL),
  basePath: "/v1",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,

  emailAndPassword: {
    enabled: true,
  },

  user: {
    additionalFields: {
      username: { type: "string", unique: true, required: true },
      displayName: { type: "string" },
      type: { type: "string", defaultValue: "user" },
    },
  },

  session: {
    expiresIn: sessionMaxAge,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  socialProviders:
    Object.keys(socialProviders).length > 0 ? socialProviders : undefined,

  plugins,
});
