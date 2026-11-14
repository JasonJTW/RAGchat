import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { createDatabase, dropDatabase } from "./src/databases.js";
import { DEFAULT_DATABASE_URL, migrate } from "./src/db.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    pseudonymKey: string;
  }
}

// Each test run gets a database of its own on the shared Postgres, migrated
// from empty and dropped afterwards, so worktrees can run tests side by side.
// The server comes from DATABASE_URL (shell first, then the root .env; CI sets
// it to its service container), or the `docker compose` default.
export default async function setup(project: TestProject) {
  const testUrl = new URL(
    process.env.DATABASE_URL || rootEnv().DATABASE_URL || DEFAULT_DATABASE_URL,
  );
  testUrl.pathname = `/ragchat_test_${randomBytes(6).toString("hex")}`;
  await createDatabase(testUrl.href);
  const pool = new pg.Pool({ connectionString: testUrl.href });
  try {
    await migrate(drizzle(pool));
  } finally {
    await pool.end();
  }
  project.provide("databaseUrl", testUrl.href);
  // One pseudonym key per run, as there is one database: every test file
  // reads the pseudonyms the others wrote (the team workspace's). Never the
  // key in .env.
  project.provide("pseudonymKey", randomBytes(32).toString("base64"));

  return () => dropDatabase(testUrl.href);
}

function rootEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
  } catch {
    return {};
  }
}
