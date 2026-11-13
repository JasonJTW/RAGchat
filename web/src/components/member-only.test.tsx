import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemberOnly } from "./member-only";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

/** Answers GET /api/me the way the server does for this caller. */
function serverSays(status: number, body?: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(body ?? {}, { status }))),
  );
}

function renderGate() {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemberOnly>
        <p>聊天</p>
      </MemberOnly>
    </SWRConfig>,
  );
}

beforeEach(() => replace.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows a 成員 what it guards", async () => {
  serverSays(200, { userId: "user_m", role: "member" });

  renderGate();

  expect(await screen.findByText("聊天")).toBeInTheDocument();
});

it("tells a 訪客 that guest trials are not open yet", async () => {
  serverSays(200, { userId: "user_g", role: "guest" });

  renderGate();

  expect(await screen.findByRole("status")).toHaveTextContent(
    "訪客試用尚未開放",
  );
  expect(screen.queryByText("聊天")).toBeNull();
});

it("sends a signed-out visitor to sign in", async () => {
  serverSays(401, { error: "sign in first" });

  renderGate();

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  expect(screen.queryByText("聊天")).toBeNull();
});
