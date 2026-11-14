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

declare global {
  var RAGCHAT_POOL: { url: string; pool: pg.Pool } | undefined;
}

// One pool per database URL in the process, kept on globalThis: a test that
// re-imports this module (vi.resetModules) reuses it instead of opening
// another pool's connections.
const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
if (globalThis.RAGCHAT_POOL?.url !== url) {
  const created = new pg.Pool({ connectionString: url });
  // An idle connection that drops (e.g. Postgres restarts, or a test run
  // drops its database) is replaced on the next query; without a listener it
  // would crash the server.
  created.on("error", (error) => {
    console.error("database connection lost:", error.message);
  });
  globalThis.RAGCHAT_POOL = { url, pool: created };
}
const pool = globalThis.RAGCHAT_POOL.pool;

export const db = drizzle(pool, { schema });

/** A transaction of `db`, as its callback gets it. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Whether the id is a UUID, as every row id is; any other is no row's. */
export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

/** Applies every migration not yet applied to the database. */
export function migrate(database: typeof db = db): Promise<void> {
  return runMigrations(database, { migrationsFolder: MIGRATIONS });
}

/** Closes the pool, so a script or test run can exit. */
export function closeDb(): Promise<void> {
  if (globalThis.RAGCHAT_POOL?.pool === pool)
    globalThis.RAGCHAT_POOL = undefined;
  return pool.end();
}
