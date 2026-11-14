import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/chat-message";
import { ProposalCard } from "./proposal-card";

type Item = Proposal["items"][number];

const item = (n: number, kind: Item["kind"] = "add"): Item => ({
  id: `item-${n}`,
  kind,
  factId: `fact-${n}`,
  content: `事實 ${n}`,
  status: "pending",
});

const proposalOf = (items: Item[]): Proposal => ({
  id: "p1",
  status: "pending",
  createdBy: "user_a",
  createdAt: "2026-11-14T00:00:00.000Z",
  items,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists a few 新增 items open, each ticked", () => {
  render(<ProposalCard proposal={proposalOf([item(1), item(2)])} />);

  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  for (const box of screen.getAllByRole("checkbox", { name: "納入" }))
    expect(box).toBeChecked();
  expect(screen.getByRole("button", { name: "確認" })).toBeEnabled();
});

it("puts 取代 and 過時 first and open, folding many 新增 items", () => {
  const items = [
    ...Array.from({ length: 30 }, (_, i) => item(i)),
    item(100, "supersede"),
    item(101, "obsolete"),
  ];
  const { container } = render(<ProposalCard proposal={proposalOf(items)} />);

  const groups = container.querySelectorAll("details");
  expect(
    [...groups].map((g) => g.querySelector("summary")?.textContent),
  ).toEqual(["取代與過時", "新增（30 項）", "標記敏感詞"]);
  expect(groups[0]).toHaveAttribute("open");
  expect(groups[1]).not.toHaveAttribute("open");
  expect(groups[0]).toHaveTextContent("事實 100");
  expect(screen.getByRole("heading")).toHaveTextContent(
    "提案 · 取代 1 項、過時 1 項、新增 30 項",
  );
});

it("confirms only the ticked items, and shows the unticked ones as left out", async () => {
  const items = Array.from({ length: 31 }, (_, i) => item(i));
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    const { excluded } = JSON.parse(init.body as string) as {
      excluded: string[];
    };
    return Promise.resolve(
      Response.json({
        ...proposalOf(items),
        status: "confirmed",
        items: items.map((it) => ({
          ...it,
          status: excluded.includes(it.id) ? "rejected" : "confirmed",
        })),
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  render(<ProposalCard proposal={proposalOf(items)} />);

  const boxes = screen.getAllByRole("checkbox", { name: "納入", hidden: true });
  fireEvent.click(boxes[3]);
  fireEvent.click(boxes[7]);
  fireEvent.click(screen.getByRole("button", { name: "確認所選（29 項）" }));

  expect(await screen.findByText("已確認，已寫入知識庫。")).toBeVisible();
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("/api/proposals/p1/confirm");
  expect(JSON.parse(init.body as string)).toEqual({
    edits: [],
    excluded: ["item-3", "item-7"],
    acknowledged: [],
  });
  const leftOut = screen
    .getAllByRole("listitem", { hidden: true })
    .filter((li) => li.textContent?.includes("未納入"));
  expect(leftOut.map((li) => li.textContent)).toEqual([
    "事實 3未納入",
    "事實 7未納入",
  ]);
});

it("cannot confirm with every item unticked", () => {
  render(<ProposalCard proposal={proposalOf([item(1)])} />);

  fireEvent.click(screen.getByRole("checkbox", { name: "納入" }));

  expect(screen.getByRole("button", { name: /^確認所選/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "拒絕" })).toBeEnabled();
});
