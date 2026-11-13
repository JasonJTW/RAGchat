import { clerkClient, clerkMiddleware, getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { stubIdentity } from "./stub-auth.js";

// Who signed in, through Clerk (ADR: spec #22 存取). Members of the MegaWeaving
// Organization (CLERK_MEMBER_ORG_ID) are 成員; every other signed-in user is a
// 訪客. Without CLERK_SECRET_KEY nobody is signed in, unless stub sign-in is on.

/** A signed-in user and whether they are a 成員 or a 訪客. */
export interface Identity {
  userId: string;
  role: "member" | "guest";
}

/**
 * True when stub sign-in (STUB_AUTH=1, see stub-auth.ts) is on. Refused when
 * a real Clerk key is set or in production, so a stray flag can't open a
 * back door.
 */
export function stubAuth(): boolean {
  return (
    process.env.STUB_AUTH === "1" &&
    !process.env.CLERK_SECRET_KEY &&
    process.env.NODE_ENV !== "production"
  );
}

/** Problems with the auth env, for the server to report at startup. */
export function authWarnings(): string[] {
  if (process.env.STUB_AUTH === "1" && !stubAuth())
    return [
      "STUB_AUTH=1 is ignored: it never runs with CLERK_SECRET_KEY set or in production.",
    ];
  if (stubAuth()) return ["STUB_AUTH=1: sign-in is faked by a cookie."];
  const warnings = [];
  if (!process.env.CLERK_SECRET_KEY)
    warnings.push("CLERK_SECRET_KEY is not set: nobody can sign in.");
  if (!process.env.CLERK_MEMBER_ORG_ID)
    warnings.push("CLERK_MEMBER_ORG_ID is not set: every user is a 訪客.");
  return warnings;
}

let clerk: RequestHandler | undefined;

/** Reads the Clerk session of each request; mount before any route. */
export const authentication: RequestHandler = (req, res, next) => {
  if (stubAuth() || !process.env.CLERK_SECRET_KEY) return next();
  clerk ??= clerkMiddleware({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
  return clerk(req, res, next);
};

/** The signed-in user of a request, or null when nobody is signed in. */
export async function identify(req: Request): Promise<Identity | null> {
  if (stubAuth()) return stubIdentity(req.headers.cookie);
  if (!process.env.CLERK_SECRET_KEY) return null;
  const { userId, orgId } = getAuth(req);
  if (!userId) return null;
  return {
    userId,
    role: (await isMember(userId, orgId)) ? "member" : "guest",
  };
}

// Membership is looked up at Clerk and kept for a minute, so removing someone
// from the Organization takes effect within a minute.
const MEMBERSHIP_TTL_MS = 60_000;
const memberships = new Map<string, { member: boolean; until: number }>();

async function isMember(
  userId: string,
  activeOrgId: string | null | undefined,
): Promise<boolean> {
  const org = process.env.CLERK_MEMBER_ORG_ID;
  if (!org) return false;
  if (activeOrgId === org) return true;
  const key = `${org}:${userId}`;
  const cached = memberships.get(key);
  if (cached && cached.until > Date.now()) return cached.member;
  const { totalCount } =
    await clerkClient.organizations.getOrganizationMembershipList({
      organizationId: org,
      userId: [userId],
    });
  const member = totalCount > 0;
  memberships.set(key, { member, until: Date.now() + MEMBERSHIP_TTL_MS });
  return member;
}
