import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, dropDatabase } from "./databases.js";

// scripts/backup.sh and scripts/restore.sh, run as the host's cron would:
// against the Postgres container that serves this test run's database.

const scripts = fileURLToPath(new URL("../../scripts/", import.meta.url));
const testUrl = new URL(process.env.DATABASE_URL!);
// The container publishing the test server's port (the shared dev one locally,
// the service container in CI).
const container = execFileSync(
  "docker",
  [
    "ps",
    "--filter",
    `publish=${testUrl.port || 5432}`,
    "--format",
    "{{.Names}}",
  ],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")[0];
if (!container) throw new Error(`no container publishes port ${testUrl.port}`);

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function urlFor(name: string) {
  const url = new URL(testUrl);
  url.pathname = `/${name}`;
  return url.href;
}

async function newDatabase() {
  const name = `ragchat_backup_${randomBytes(4).toString("hex")}`;
  await createDatabase(urlFor(name));
  cleanups.push(() => dropDatabase(urlFor(name)));
  return name;
}

async function query(name: string, sql: string): Promise<unknown[]> {
  const client = new pg.Client({ connectionString: urlFor(name) });
  await client.connect();
  try {
    return (await client.query<Record<string, unknown>>(sql)).rows;
  } finally {
    await client.end();
  }
}

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "ragchat-backup-"));
}

function run(script: string, env: Record<string, string>, args: string[] = []) {
  return spawnSync("bash", [path.join(scripts, script), ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
      BACKUP_PG_CONTAINER: container,
      // No .env next to the scripts' repo is read in tests.
      BACKUP_ENV_FILE: "/dev/null",
      ...env,
    },
  });
}

const dumps = (dir: string) =>
  readdirSync(dir).filter((file) => /^ragchat-.*\.dump$/.test(file));

describe("backup.sh and restore.sh", () => {
  it("dumps the database into BACKUP_DIR, and restore.sh brings it back into a new database", async () => {
    const source = await newDatabase();
    await query(
      source,
      "create table facts (id int primary key, body text); insert into facts values (1, '外包電費 8000')",
    );
    const dir = tempDir();

    const backup = run("backup.sh", {
      BACKUP_DIR: dir,
      BACKUP_PG_DATABASE: source,
    });
    expect(backup.stderr).toBe("");
    expect(backup.status).toBe(0);
    const [dump] = dumps(dir);
    expect(dump).toMatch(/^ragchat-\d{8}-\d{6}\.dump$/);
    // Only the owner can read a dump.
    expect(statSync(path.join(dir, dump)).mode & 0o077).toBe(0);

    const target = `ragchat_restore_${randomBytes(4).toString("hex")}`;
    cleanups.push(() => dropDatabase(urlFor(target)));
    const restore = run("restore.sh", { BACKUP_PG_DATABASE: target }, [
      path.join(dir, dump),
    ]);
    expect(restore.status, restore.stderr).toBe(0);
    expect(await query(target, "select * from facts")).toEqual([
      { id: 1, body: "外包電費 8000" },
    ]);
  });

  it("restore.sh never restores over an existing database", async () => {
    const source = await newDatabase();
    await query(source, "create table facts (id int)");
    const dir = tempDir();
    run("backup.sh", { BACKUP_DIR: dir, BACKUP_PG_DATABASE: source });
    const existing = await newDatabase();
    await query(
      existing,
      "create table live (id int); insert into live values (7)",
    );

    const restore = run("restore.sh", { BACKUP_PG_DATABASE: existing }, [
      path.join(dir, dumps(dir)[0]),
    ]);

    expect(restore.status).not.toBe(0);
    expect(await query(existing, "select * from live")).toEqual([{ id: 7 }]);
    expect(
      await query(existing, "select to_regclass('facts') as facts"),
    ).toEqual([{ facts: null }]);
  });

  describe("refuses a BACKUP_DIR that holds the encryption key", () => {
    const key = randomBytes(32).toString("base64");
    const envFile = (dir: string) => {
      writeFileSync(
        path.join(dir, ".env"),
        `PSEUDONYM_ENCRYPTION_KEY=${key}\n`,
      );
      return path.join(dir, ".env");
    };

    it.each([
      ["holds a .env", (dir: string) => ({ BACKUP_ENV_FILE: envFile(dir) })],
      [
        "contains the .env's directory",
        (dir: string) => {
          mkdirSync(path.join(dir, "ragchat"));
          return { BACKUP_ENV_FILE: envFile(path.join(dir, "ragchat")) };
        },
      ],
      [
        "has a file with the key in it",
        (dir: string) => {
          writeFileSync(path.join(dir, "keys.txt"), `pseudonyms: ${key}\n`);
          return { BACKUP_ENV_FILE: envFile(tempDir()) };
        },
      ],
    ])("when it %s", async (_, setUp) => {
      const database = await newDatabase();
      const dir = tempDir();

      const backup = run("backup.sh", {
        BACKUP_DIR: dir,
        BACKUP_PG_DATABASE: database,
        ...setUp(dir),
      });

      expect(backup.status).not.toBe(0);
      expect(backup.stderr).toMatch(/encryption key/);
      expect(dumps(dir)).toEqual([]);
    });
  });

  it("deletes its own dumps older than 14 days and keeps everything else", async () => {
    const database = await newDatabase();
    const dir = tempDir();
    const daysAgo = (file: string, days: number) => {
      writeFileSync(path.join(dir, file), "old");
      const time = new Date(Date.now() - days * 86_400_000);
      utimesSync(path.join(dir, file), time, time);
    };
    daysAgo("ragchat-20261020-030000.dump", 25);
    daysAgo("ragchat-20261030-030000.dump", 15);
    daysAgo("ragchat-20261101-030000.dump", 13);
    daysAgo("notes.txt", 30);

    const backup = run("backup.sh", {
      BACKUP_DIR: dir,
      BACKUP_PG_DATABASE: database,
    });

    expect(backup.status, backup.stderr).toBe(0);
    const left = readdirSync(dir).sort();
    expect(left).toHaveLength(3);
    expect(left).toContain("ragchat-20261101-030000.dump");
    expect(left).toContain("notes.txt");
    expect(left).not.toContain("ragchat-20261030-030000.dump");
  });

  describe("BACKUP_RCLONE_REMOTE", () => {
    // A stand-in for rclone that records how it was called.
    function fakeRclone(exitCode = 0) {
      const bin = tempDir();
      const log = path.join(bin, "calls");
      writeFileSync(
        path.join(bin, "rclone"),
        `#!/usr/bin/env bash\necho "$*" >> "${log}"\nexit ${exitCode}\n`,
      );
      chmodSync(path.join(bin, "rclone"), 0o755);
      return {
        PATH: `${bin}:${process.env.PATH}`,
        calls: () => readFileSync(log, "utf8").trim().split("\n"),
      };
    }

    it("copies the new dump to the remote and expires remote dumps after 14 days", async () => {
      const database = await newDatabase();
      const dir = tempDir();
      const rclone = fakeRclone();

      const backup = run("backup.sh", {
        BACKUP_DIR: dir,
        BACKUP_PG_DATABASE: database,
        BACKUP_RCLONE_REMOTE: "offsite:ragchat",
        PATH: rclone.PATH,
      });

      expect(backup.status, backup.stderr).toBe(0);
      const [dump] = dumps(dir);
      expect(rclone.calls()).toEqual([
        `copy ${path.join(statDir(dir), dump)} offsite:ragchat`,
        "delete offsite:ragchat --min-age 14d --include ragchat-*.dump",
      ]);
    });

    it("fails the backup when the copy fails, keeping the local dump", async () => {
      const database = await newDatabase();
      const dir = tempDir();

      const backup = run("backup.sh", {
        BACKUP_DIR: dir,
        BACKUP_PG_DATABASE: database,
        BACKUP_RCLONE_REMOTE: "offsite:ragchat",
        PATH: fakeRclone(1).PATH,
      });

      expect(backup.status).not.toBe(0);
      expect(dumps(dir)).toHaveLength(1);
    });
  });

  it("fails without leaving a dump when pg_dump fails", () => {
    const dir = tempDir();

    const backup = run("backup.sh", {
      BACKUP_DIR: dir,
      BACKUP_PG_DATABASE: "ragchat_no_such_database",
    });

    expect(backup.status).not.toBe(0);
    expect(readdirSync(dir)).toEqual([]);
  });
});

// The directory as the script sees it (macOS tmpdir is a symlink).
function statDir(dir: string) {
  return execFileSync("pwd", ["-P"], { cwd: dir, encoding: "utf8" }).trim();
}
