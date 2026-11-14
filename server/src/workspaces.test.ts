import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { stubSession } from "./stub-auth.js";
import { callerOf } from "./workspaces.js";

const requestFrom = (cookie?: string) =>
  ({ headers: cookie ? { cookie } : {} }) as Request;

describe("callerOf", () => {
  it("puts every 成員 in the one team workspace, as their own user id", async () => {
    const a = await callerOf(requestFrom(stubSession("user_a", "member")));
    const b = await callerOf(requestFrom(stubSession("user_b", "member")));

    expect(a).toMatchObject({ userId: "user_a" });
    expect(b).toMatchObject({ userId: "user_b" });
    expect(a).toHaveProperty(
      "workspaceId",
      (b as { workspaceId: string }).workspaceId,
    );
  });

  it("gives a 訪客 no workspace before they pass the human check", async () => {
    expect(await callerOf(requestFrom(stubSession("user_g", "guest")))).toBe(
      "unverified",
    );
  });

  it("gives a caller who is not signed in no workspace", async () => {
    expect(await callerOf(requestFrom())).toBe("signed out");
  });
});
