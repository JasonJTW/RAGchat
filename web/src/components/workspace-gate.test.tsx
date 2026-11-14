import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceGate } from "./workspace-gate";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

type Route = (init?: RequestInit) => { status: number; body?: unknown };

/** Answers each request path the way the server does for this caller. */
function serverSays(routes: Record<string, Route>) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const route = routes[`${init?.method ?? "GET"} ${url}`];
    const { status, body } = route ? route(init) : { status: 404 };
    return Promise.resolve(Response.json(body ?? {}, { status }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function renderGate() {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <WorkspaceGate>
        <p>聊天</p>
      </WorkspaceGate>
    </SWRConfig>,
  );
}

beforeEach(() => {
  replace.mockClear();
  // No Turnstile site key: the human check is the stub button.
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("shows a 成員 what it guards", async () => {
  serverSays({
    "GET /api/me": () => ({
      status: 200,
      body: { userId: "user_m", role: "member" },
    }),
  });

  renderGate();

  expect(await screen.findByText("聊天")).toBeInTheDocument();
  expect(screen.queryByText(/試用工作區/)).toBeNull();
});

it("lets a 訪客 in once they pass the human check", async () => {
  let verified = false;
  const fetch = serverSays({
    "GET /api/me": () => ({
      status: 200,
      body: { userId: "user_g", role: "guest", trial: { verified } },
    }),
    "POST /api/trial/verify": () => {
      verified = true;
      return { status: 200, body: { verified: true } };
    },
  });

  renderGate();
  fireEvent.click(await screen.findByRole("button", { name: /開始試用/ }));

  expect(await screen.findByText("聊天")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(
    "/api/trial/verify",
    expect.objectContaining({ body: JSON.stringify({ token: "stub-pass" }) }),
  );
  expect(screen.getByRole("region", { name: "試用工作區" })).toHaveTextContent(
    "虛構",
  );
});

it("tells a 訪客 whose check failed to try again", async () => {
  serverSays({
    "GET /api/me": () => ({
      status: 200,
      body: { userId: "user_g", role: "guest", trial: { verified: false } },
    }),
    "POST /api/trial/verify": () => ({
      status: 403,
      body: { error: "人機驗證沒有通過，請再試一次。" },
    }),
  });

  renderGate();
  fireEvent.click(await screen.findByRole("button", { name: /開始試用/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "人機驗證沒有通過",
  );
  expect(screen.queryByText("聊天")).toBeNull();
});

it("resets a 訪客's trial when they confirm", async () => {
  vi.stubGlobal("confirm", () => true);
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, replace: reload });
  const fetch = serverSays({
    "GET /api/me": () => ({
      status: 200,
      body: { userId: "user_g", role: "guest", trial: { verified: true } },
    }),
    "POST /api/trial/reset": () => ({ status: 200, body: { reset: true } }),
  });

  renderGate();
  fireEvent.click(
    await screen.findByRole("button", { name: "重設試用工作區" }),
  );

  await waitFor(() => expect(reload).toHaveBeenCalledWith("/"));
  expect(fetch).toHaveBeenCalledWith(
    "/api/trial/reset",
    expect.objectContaining({ method: "POST" }),
  );
});

it("sends a signed-out visitor to sign in", async () => {
  serverSays({
    "GET /api/me": () => ({ status: 401, body: { error: "sign in first" } }),
  });

  renderGate();

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  expect(screen.queryByText("聊天")).toBeNull();
});
