import { asc, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { identify } from "./auth.js";
import { db } from "./db.js";
import { workspaces } from "./db/schema.js";

// Who is calling and in which 工作區. A 成員 works in the team workspace; a
// 訪客 has no workspace until guest trials open (#38).

/** The member a request acts as, and the workspace it is limited to. */
export interface Caller {
  workspaceId: string;
  userId: string;
}

/** The caller of a request, or why it has no workspace to act in. */
export async function callerOf(
  req: Request,
): Promise<Caller | "signed out" | "guest"> {
  const identity = await identify(req);
  if (!identity) return "signed out";
  if (identity.role !== "member") return "guest";
  return { workspaceId: await teamWorkspace(), userId: identity.userId };
}

/** Creates a workspace and returns its id. */
export async function createWorkspace(
  kind: "team" | "guest",
  name: string,
): Promise<string> {
  const [row] = await db
    .insert(workspaces)
    .values({ kind, name })
    .returning({ id: workspaces.id });
  return row.id;
}

let team: Promise<string> | undefined;

// The team's one workspace, created on first use. The lock keeps two servers
// starting at once from creating two.
function teamWorkspace(): Promise<string> {
  team ??= db
    .transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('team workspace'))`,
      );
      const [found] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.kind, "team"))
        .orderBy(asc(workspaces.createdAt))
        .limit(1);
      if (found) return found.id;
      const [created] = await tx
        .insert(workspaces)
        .values({ kind: "team", name: "大量交織" })
        .returning({ id: workspaces.id });
      return created.id;
    })
    .catch((error: unknown) => {
      team = undefined;
      throw error;
    });
  return team;
}
