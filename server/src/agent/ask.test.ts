import { describe, expect, it } from "vitest";
import { confirmProposal, propose, rejectProposal } from "../knowledge-base.js";
import { installStubModels } from "../stub-models.js";
import { createWorkspace } from "../workspaces.js";
import { answer, retrieve, type Evidence } from "./ask.js";

const FORMULA = "避免排放算法模型是 估算值 A = m × EF × 取代率 R × 壽命比 L";
const MESSAGE = `請把以下內容輸入到知識庫：${FORMULA}`;

/** A workspace whose knowledge base holds the facts, confirmed. */
async function workspaceWith(...contents: string[]) {
  const workspaceId = await createWorkspace("guest", "test");
  const proposal = await propose(workspaceId, "user-a", {
    source: { kind: "message", content: MESSAGE },
    facts: contents,
  });
  await confirmProposal(workspaceId, proposal.id, "user-b");
  return workspaceId;
}

const ask = (workspaceId: string, message: string) => ({
  workspaceId,
  message,
  turns: [],
});

describe("retrieve", () => {
  it("finds the confirmed fact that matches the question, with its source", async () => {
    const { vectors } = installStubModels();
    vectors.set(FORMULA, [1, 0]);
    vectors.set("週會在每週四下午", [0, 1]);
    vectors.set("避免排放算法怎麼算？", [0.9, 0.1]);
    const workspaceId = await workspaceWith("週會在每週四下午", FORMULA);

    const { evidence, similarity } = await retrieve(
      ask(workspaceId, "避免排放算法怎麼算？"),
    );

    expect(evidence[0]).toMatchObject({
      kind: "fact",
      text: FORMULA,
      source: { content: MESSAGE },
    });
    expect(evidence[0].label).toMatch(/^知識庫 · \d{4}-\d{2}-\d{2}$/);
    expect(similarity).toBeGreaterThan(0.3);
  });

  it("finds no fact of a proposal that is pending or rejected", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    const pending = await propose(workspaceId, "user-a", {
      source: { kind: "message", content: MESSAGE },
      facts: [FORMULA],
    });
    const rejected = await propose(workspaceId, "user-a", {
      source: { kind: "message", content: MESSAGE },
      facts: ["避免排放算法的 R 是回收率"],
    });
    await rejectProposal(workspaceId, rejected.id, "user-b");

    const { evidence } = await retrieve(
      ask(workspaceId, "避免排放算法怎麼算？"),
    );

    expect(pending.status).toBe("pending");
    expect(evidence.filter((e) => e.kind === "fact")).toEqual([]);
  });

  it("finds no fact of another workspace", async () => {
    installStubModels();
    await workspaceWith(FORMULA);
    const other = await createWorkspace("guest", "other");

    const { evidence } = await retrieve(ask(other, "避免排放算法怎麼算？"));

    expect(evidence.filter((e) => e.kind === "fact")).toEqual([]);
  });
});

describe("answer", () => {
  const fact: Evidence = {
    id: "f1",
    kind: "fact",
    label: "知識庫 · 2026-11-14",
    text: FORMULA,
    source: { content: MESSAGE, createdAt: "2026-11-14T00:00:00.000Z" },
  };
  const state = {
    turns: [],
    message: "避免排放怎麼算？",
    clarify: false,
    evidence: [fact],
    similarity: 0.8,
  };

  it("answers from the evidence, citing what the answer marks", async () => {
    const { chat } = installStubModels();
    chat.reply = "A = m × EF × R × L。[1]";
    const written: { type: string; delta?: string; data?: unknown }[] = [];

    const out = await answer(state, { writer: (c) => written.push(c) });

    expect(out).toEqual({
      reply: "A = m × EF × R × L。[1]",
      citations: [{ ...fact, marker: 1 }],
    });
    expect(chat.prompts[0]).toContain(`[1] 知識庫 · 2026-11-14\n${FORMULA}`);
    const text = written.flatMap((c) =>
      c.type === "text-delta" ? [c.delta] : [],
    );
    expect(text.join("")).toBe(chat.reply);
    expect(written).toContainEqual({
      type: "data-citation",
      id: "f1",
      data: { ...fact, marker: 1 },
    });
  });

  it("asks which subject is meant instead of answering when told to", async () => {
    const { chat } = installStubModels();

    const out = await answer({ ...state, clarify: true });

    expect(out).toEqual({
      reply: "請問你指的是哪個計畫或主題？",
      citations: [],
    });
    expect(chat.prompts).toEqual([]);
  });

  it("refuses without calling the model when nothing matches well enough", async () => {
    const { chat } = installStubModels();

    const out = await answer({ ...state, similarity: 0.1 });

    expect(out.reply).toContain("這個問題我無法回答");
    expect(out.citations).toEqual([]);
    expect(chat.prompts).toEqual([]);
  });
});
