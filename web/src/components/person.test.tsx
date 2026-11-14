import { cleanup, render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, expect, it, vi } from "vitest";
import { Person } from "./person";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fresh = (ui: React.ReactNode) =>
  render(<SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>);

it("shows the user's name, not their id", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ user_lin: "林小樹" }))),
  );

  fresh(
    <p>
      <Person id="user_lin" /> 提出
    </p>,
  );

  expect(await screen.findByText("林小樹 提出")).toBeInTheDocument();
  expect(screen.queryByText(/user_lin/)).toBeNull();
});

it("shows 成員 when the name can't be read", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response("", { status: 503 }))),
  );

  fresh(<Person id="user_lin" />);

  expect(await screen.findByText("成員")).toBeInTheDocument();
});
