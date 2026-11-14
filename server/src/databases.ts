import { execFileSync } from "node:child_process";
import pg from "pg";

// Creating and dropping whole databases on the Postgres server, for test runs
// that each need a database of their own (vitest.global-setup.ts, the E2E
// server). Locally, a Postgres that isn't up is started with
// `docker compose up -d --wait`.

/** Creates the database the URL names, if it doesn't exist yet. */
export async function createDatabase(url: string): Promise<void> {
  const { admin, name } = await adminFor(url);
  try {
    const { rowCount } = await admin.query(
      "select 1 from pg_database where datname = $1",
      [name],
    );
    if (!rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

/** Drops the database the URL names, closing its connections. */
export async function dropDatabase(url: string): Promise<void> {
  const { admin, name } = await adminFor(url);
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

// A connection to the server's `postgres` database, and the name in the URL.
async function adminFor(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^\w+$/.test(name)) throw new Error(`unsafe database name: ${name}`);
  target.pathname = "/postgres";
  return { admin: await connect(target.href), name };
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
        cwd: new URL("../..", import.meta.url),
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
