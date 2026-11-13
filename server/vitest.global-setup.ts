import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { DEFAULT_DATABASE_URL, migrate } from "./src/db.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

// Each test run gets a database of its own on the shared Postgres, migrated
// from empty and dropped afterwards, so worktrees can run tests side by side.
// The server comes from DATABASE_URL (shell first, then the root .env; CI sets
// it to its service container), or the `docker compose` default. Locally, a
// Postgres that isn't up is started with `docker compose up -d --wait`.
export default async function setup(project: TestProject) {
  const serverUrl = new URL(
    process.env.DATABASE_URL || rootEnv().DATABASE_URL || DEFAULT_DATABASE_URL,
  );
  const admin = await connect(serverUrl.href);
  const name = `ragchat_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);

  const testUrl = new URL(serverUrl);
  testUrl.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: testUrl.href });
  try {
    await migrate(drizzle(pool));
  } finally {
    await pool.end();
  }
  project.provide("databaseUrl", testUrl.href);

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  };
}

async function connect(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch (error) {
    if (process.env.CI || !isRefused(error)) throw error;
    console.log("Postgres is not up; starting it with docker compose…");
    try {
      execFileSync("docker", ["compose", "up", "-d", "--wait", "postgres"], {
        cwd: new URL("..", import.meta.url),
        stdio: "inherit",
      });
    } catch {
      // Another worktree's run may be starting the same container; wait for it.
    }
    // A failed client can't reconnect; each attempt uses a fresh one.
    for (let attempt = 1; ; attempt++) {
      const retry = new pg.Client({ connectionString });
      try {
        await retry.connect();
        return retry;
      } catch (retryError) {
        if (attempt === 30) throw retryError;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

function isRefused(error: unknown) {
  const code = (error as { code?: string }).code;
  return code === "ECONNREFUSED" || error instanceof AggregateError;
}

function rootEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
  } catch {
    return {};
  }
}
