import { and, eq, getTableName, lt, sql } from "drizzle-orm";
import { db } from "./db.js";
import { guestUsage, workspaces } from "./db/schema.js";
import { copyDemoSeed, NOT_SEED, workspaceTables } from "./demo-seed.js";

// 試用工作區: each 訪客's own workspace, holding the 示範資料 until they change
// it. A 訪客 gets it once they pass the human check (Turnstile), which then
// holds for a day; it is reset to the 示範資料 on request, and deleted after 7
// days without a request. What a 訪客 may use per day, and all of them
// together, is counted here too.

/** How long a passed human check holds. */
const VERIFIED_FOR = "24 hours";
/** A trial with no request for this long is deleted. */
const IDLE_FOR = "7 days";

/** What one 訪客 may use per day, and the largest file they may upload. */
export const GUEST_LIMITS = {
  messages: 30,
  uploads: 5,
  fileBytes: 1024 * 1024,
};

/**
 * What all 訪客 together may use per day (messages plus uploaded files):
 * GUEST_DAILY_CAP, 1000 by default. Once used up, guest trials pause.
 */
export function guestDailyCap(): number {
  const cap = Number(process.env.GUEST_DAILY_CAP);
  return Number.isInteger(cap) && cap >= 0 && process.env.GUEST_DAILY_CAP
    ? cap
    : 1000;
}

/**
 * The 訪客's trial workspace, or "unverified" until they pass the human
 * check (again, once a day). Counts as a request, keeping the trial alive.
 */
export async function trialOf(
  userId: string,
): Promise<{ workspaceId: string } | "unverified"> {
  const [row] = await db
    .update(workspaces)
    .set({ lastActiveAt: sql`now()` })
    .where(
      and(
        eq(workspaces.kind, "guest"),
        eq(workspaces.ownerId, userId),
        sql`${workspaces.verifiedUntil} > now()`,
      ),
    )
    .returning({ id: workspaces.id });
  return row ? { workspaceId: row.id } : "unverified";
}

/**
 * Records that the 訪客 passed the human check, for a day. Their first pass
 * makes their trial workspace from the 示範資料.
 */
export async function verifyGuest(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('trial'), hashtext(${userId}))`,
    );
    const [found] = await tx
      .update(workspaces)
      .set({
        verifiedUntil: sql`now() + ${VERIFIED_FOR}::interval`,
        lastActiveAt: sql`now()`,
      })
      .where(and(eq(workspaces.kind, "guest"), eq(workspaces.ownerId, userId)))
      .returning({ id: workspaces.id });
    if (found) return;
    const [created] = await tx
      .insert(workspaces)
      .values({
        kind: "guest",
        name: "試用工作區",
        ownerId: userId,
        lastActiveAt: sql`now()`,
        verifiedUntil: sql`now() + ${VERIFIED_FOR}::interval`,
      })
      .returning({ id: workspaces.id });
    await copyDemoSeed(tx, created.id);
  });
}

/**
 * Puts the 訪客's trial workspace back to the 示範資料: their sources, facts,
 * proposals and conversations are gone.
 */
export async function resetTrial(workspaceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from ${workspaces} where ${workspaces.id} = ${workspaceId} for update`,
    );
    for (const table of NOT_SEED)
      await tx.execute(
        sql`delete from ${sql.identifier(getTableName(table))} where workspace_id = ${workspaceId}`,
      );
    for (const table of workspaceTables().reverse())
      await tx.execute(
        sql`delete from ${sql.identifier(getTableName(table))} where workspace_id = ${workspaceId}`,
      );
    await copyDemoSeed(tx, workspaceId);
  });
}

/** Deletes the trials with no request for 7 days; returns how many. */
export async function deleteIdleTrials(): Promise<number> {
  const deleted = await db
    .delete(workspaces)
    .where(
      and(
        eq(workspaces.kind, "guest"),
        lt(
          sql`coalesce(${workspaces.lastActiveAt}, ${workspaces.createdAt})`,
          sql`now() - ${IDLE_FOR}::interval`,
        ),
      ),
    )
    .returning({ id: workspaces.id });
  // Usage older than yesterday counts toward no limit any more.
  await db.delete(guestUsage).where(lt(guestUsage.day, sql`${today} - 1`));
  return deleted.length;
}

/** Why a 訪客's request was refused: their own limit, or every 訪客's. */
export type Refusal = "messages" | "uploads" | "paused";

// The calendar day in Taiwan.
const today = sql`(now() at time zone 'Asia/Taipei')::date`;

// Thrown to roll the count back when a limit is reached.
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal);
  }
}

/**
 * Counts a 訪客's message and uploaded files toward today's limits, or
 * refuses them (counting nothing) when that would go over the 訪客's own
 * limit or every 訪客's cap.
 */
export async function useAllowance(
  userId: string,
  use: { messages: number; uploads: number },
): Promise<"ok" | Refusal> {
  try {
    await db.transaction(async (tx) => {
      const add = async (user: string) => {
        const [row] = await tx
          .insert(guestUsage)
          .values({ userId: user, day: today, ...use })
          .onConflictDoUpdate({
            target: [guestUsage.userId, guestUsage.day],
            set: {
              messages: sql`${guestUsage.messages} + excluded.messages`,
              uploads: sql`${guestUsage.uploads} + excluded.uploads`,
            },
          })
          .returning({
            messages: guestUsage.messages,
            uploads: guestUsage.uploads,
          });
        return row;
      };
      const own = await add(userId);
      if (own.messages > GUEST_LIMITS.messages) throw new Refused("messages");
      if (own.uploads > GUEST_LIMITS.uploads) throw new Refused("uploads");
      const all = await add("*");
      if (all.messages + all.uploads > guestDailyCap())
        throw new Refused("paused");
    });
    return "ok";
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}
