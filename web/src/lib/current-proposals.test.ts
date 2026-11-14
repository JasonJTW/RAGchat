import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage, Proposal } from "./chat-message";
import { withCurrentProposals } from "./current-proposals";

const card = (id: string, status: Proposal["status"]): Proposal => ({
  id,
  status,
  sourceId: "s1",
  createdBy: "user_a",
  createdAt: "2026-11-14T00:00:00.000Z",
  items: [],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("gives each proposal card, and each 待確認 citation's, its state now, dropping a deleted one", async () => {
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url === "/api/proposals/p1"
        ? Response.json(card("p1", "confirmed"))
        : url === "/api/proposals/p3"
          ? Response.json(card("p3", "expired"))
          : Response.json({ error: "proposal not found" }, { status: 404 }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const messages: ChatMessage[] = [
    {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "我整理出 1 則事實" },
        { type: "data-proposal", id: "p1", data: card("p1", "pending") },
        { type: "data-proposal", id: "p2", data: card("p2", "pending") },
        {
          type: "data-citation",
          data: {
            id: "f1",
            marker: 1,
            kind: "fact",
            label: "待確認",
            text: "x",
            proposal: card("p3", "pending"),
          },
        },
      ],
    },
  ];

  const current = await withCurrentProposals(messages);

  expect(current[0].parts).toEqual([
    { type: "text", text: "我整理出 1 則事實" },
    { type: "data-proposal", id: "p1", data: card("p1", "confirmed") },
    {
      type: "data-citation",
      data: expect.objectContaining({ proposal: card("p3", "expired") }),
    },
  ]);
});

it("keeps a card as saved when its state can't be read now", async () => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  const messages: ChatMessage[] = [
    {
      id: "m1",
      role: "assistant",
      parts: [{ type: "data-proposal", id: "p1", data: card("p1", "pending") }],
    },
  ];

  expect(await withCurrentProposals(messages)).toEqual(messages);
});
