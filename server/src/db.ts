import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./db/schema.js";

// The knowledge base's one Postgres (ADR-0001), reached through Drizzle. The
// pool connects on the first query, so importing this needs no running
// database. Tests point DATABASE_URL at a database of their own (see
// vitest.global-setup.ts).

/** The URL `docker compose up -d postgres` serves, used when DATABASE_URL is unset. */
export const DEFAULT_DATABASE_URL =
  "postgres://ragchat:ragchat@localhost:5433/ragchat";

const MIGRATIONS = fileURLToPath(new URL("../drizzle/", import.meta.url));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

export const db = drizzle(pool, { schema });

/** Applies every migration not yet applied to the database. */
export function migrate(database: typeof db = db): Promise<void> {
  return runMigrations(database, { migrationsFolder: MIGRATIONS });
}

/** Closes the pool, so a script or test run can exit. */
export function closeDb(): Promise<void> {
  return pool.end();
}
