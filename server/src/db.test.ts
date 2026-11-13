import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "./db.js";
import { workspaces } from "./db/schema.js";

// Runs against the real Postgres database this test run created and migrated
// (see vitest.global-setup.ts).
describe("database", () => {
  it("stores a workspace and reads it back", async () => {
    const [created] = await db
      .insert(workspaces)
      .values({ kind: "team", name: "大量交織" })
      .returning();

    const [read] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, created.id));

    expect(read).toMatchObject({ kind: "team", name: "大量交織" });
    expect(read.createdAt).toBeInstanceOf(Date);
  });

  it("has pgvector and pg_trgm installed by the migrations", async () => {
    const { rows } = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension order by extname`,
    );
    expect(rows.map((row) => row.extname)).toEqual(
      expect.arrayContaining(["pg_trgm", "vector"]),
    );
  });
});
