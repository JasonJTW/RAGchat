import { asc, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { db } from "./db.js";
import { workspaces } from "./db/schema.js";

// Who is calling and in which 工作區. Until Clerk sign-in (#25) every caller
// is the same anonymous member of the team workspace.

/** The member a request acts as, and the workspace it is limited to. */
export interface Caller {
  workspaceId: string;
  userId: string;
}

export const ANONYMOUS_USER = "anonymous";

/** The caller of a request; for now always the team's anonymous member. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- sign-in (#25) reads it
export async function callerOf(req: Request): Promise<Caller> {
  return { workspaceId: await teamWorkspace(), userId: ANONYMOUS_USER };
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
