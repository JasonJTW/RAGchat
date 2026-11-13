import type { Request } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real sign-in path, with Clerk's SDK faked at the vendor boundary: the
// session says who signed in, the Organization API says who is a 成員.
const clerk = vi.hoisted(() => ({
  auth: { userId: null as string | null, orgId: null as string | null },
  members: new Set<string>(),
  lookups: 0,
  down: false,
}));
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  getAuth: () => clerk.auth,
  clerkClient: {
    organizations: {
      getOrganizationMembershipList: ({
        organizationId,
        userId,
      }: {
        organizationId: string;
        userId: string[];
      }) => {
        clerk.lookups++;
        if (clerk.down) return Promise.reject(new Error("Clerk is down"));
        const totalCount = userId.filter((id) =>
          clerk.members.has(`${organizationId}:${id}`),
        ).length;
        return Promise.resolve({ data: [], totalCount });
      },
    },
  },
}));
const { identify } = await import("./auth.js");
const { app } = await import("./app.js");

const req = { headers: {} } as Request;

beforeEach(() => {
  vi.stubEnv("STUB_AUTH", "");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("CLERK_MEMBER_ORG_ID", "org_mw");
  clerk.auth = { userId: null, orgId: null };
  clerk.members.clear();
  clerk.down = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("identify with Clerk", () => {
  it("finds nobody without a session", async () => {
    expect(await identify(req)).toBeNull();
  });

  it("makes a member of the MegaWeaving Organization a 成員", async () => {
    clerk.auth.userId = "user_m1";
    clerk.members.add("org_mw:user_m1");

    expect(await identify(req)).toEqual({ userId: "user_m1", role: "member" });
  });

  it("makes a member of another Organization a 訪客", async () => {
    clerk.auth = { userId: "user_x1", orgId: "org_other" };
    clerk.members.add("org_other:user_x1");

    expect(await identify(req)).toEqual({ userId: "user_x1", role: "guest" });
  });

  it("trusts the session's active Organization without a lookup", async () => {
    clerk.auth = { userId: "user_m2", orgId: "org_mw" };
    const before = clerk.lookups;

    expect(await identify(req)).toEqual({ userId: "user_m2", role: "member" });
    expect(clerk.lookups).toBe(before);
  });

  it("makes everyone a 訪客 while CLERK_MEMBER_ORG_ID is unset", async () => {
    vi.stubEnv("CLERK_MEMBER_ORG_ID", "");
    clerk.auth = { userId: "user_m3", orgId: "org_mw" };

    expect(await identify(req)).toEqual({ userId: "user_m3", role: "guest" });
  });

  it("finds nobody while CLERK_SECRET_KEY is unset", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    clerk.auth.userId = "user_m1";

    expect(await identify(req)).toBeNull();
  });

  it("ignores stub sessions while a real Clerk key is set", async () => {
    vi.stubEnv("STUB_AUTH", "1");
    const stubbed = {
      headers: { cookie: "stub_session=user_evil%3Amember" },
    } as Request;

    expect(await identify(stubbed)).toBeNull();
  });

  it("ignores stub sessions in production", async () => {
    vi.stubEnv("STUB_AUTH", "1");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const stubbed = {
      headers: { cookie: "stub_session=user_evil%3Amember" },
    } as Request;

    expect(await identify(stubbed)).toBeNull();
  });
});

describe("when Clerk cannot be reached", () => {
  it("answers 500 without internals", async () => {
    clerk.auth.userId = "user_down";
    clerk.down = true;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).post("/api/chat").send({ messages: [] });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal error" });
  });
});
