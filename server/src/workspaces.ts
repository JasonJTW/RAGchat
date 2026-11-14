import { asc, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { identify } from "./auth.js";
import { db } from "./db.js";
import { trialOf } from "./trial.js";
import { workspaces } from "./db/schema.js";

// Who is calling and in which 工作區. A 成員 works in the team workspace; a
// 訪客 in their own 試用工作區 (trial.ts), once they passed the human check.

/** The user a request acts as, and the workspace it is limited to. */
export interface Caller {
  workspaceId: string;
  userId: string;
  /** A 訪客 is held to the trial's limits and answered by GUEST_MODEL. */
  role?: "member" | "guest";
}

/**
 * The caller of a request, or why it has no workspace to act in: nobody
 * signed in, or a 訪客 who has not passed the human check (today).
 */
export async function callerOf(
  req: Request,
): Promise<Caller | "signed out" | "unverified"> {
  const identity = await identify(req);
  if (!identity) return "signed out";
  const { userId, role } = identity;
  if (role === "member")
    return { workspaceId: await teamWorkspace(), userId, role };
  const trial = await trialOf(userId);
  if (trial === "unverified") return trial;
  return { workspaceId: trial.workspaceId, userId, role };
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
