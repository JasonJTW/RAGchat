import { describe, expect, it } from "vitest";
import { confirmProposal, propose, rejectProposal } from "../knowledge-base.js";
import { installStubModels } from "../stub-models.js";
import { createWorkspace } from "../workspaces.js";
import { answer, checkSubject, retrieve, type Evidence } from "./ask.js";
import { linkEntities } from "./link-entities.js";

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

describe("retrieve through entities", () => {
  /** Confirms each fact with the entities 「…」 names (the stub linker's way). */
  async function confirmLinked(workspaceId: string, ...contents: string[]) {
    const [linked] = (
      await linkEntities({
        workspaceId,
        inputs: [{ facts: contents.map((content) => ({ content })) }],
      })
    ).inputs;
    const proposal = await propose(workspaceId, "user-a", {
      source: { kind: "message", content: contents.join("\n") },
      facts: linked.facts,
    });
    await confirmProposal(workspaceId, proposal.id, "user-b");
    return proposal;
  }

  // Facts that match any question better than the related ones do.
  const DISTRACTORS = Array.from({ length: 8 }, (_, i) => `週會第 ${i} 項`);

  it("finds the facts of an entity asked about by its alias", async () => {
    const { chat, vectors } = installStubModels();
    const question = "減碳計算模型由誰負責？";
    vectors.set(question, [1, 0]);
    for (const text of DISTRACTORS) vectors.set(text, [1, 0]);
    vectors.set("避免排放算法", [0, 1, 0]);
    vectors.set("減碳計算模型", [0, 0.9, 0.1]);
    const owner = "「小林」負責「避免排放算法」";
    vectors.set(owner, [0, 0, 1]);
    const workspaceId = await createWorkspace("guest", "test");
    await confirmLinked(workspaceId, owner, ...DISTRACTORS);
    const structured = chat.structured;
    chat.structured = (text, name) =>
      name === "entity-link"
        ? { links: [{ mention: 1, entity: 1 }] }
        : structured(text, name);
    await confirmLinked(workspaceId, "「減碳計算模型」使用壽命比 L");

    const { evidence, similarity } = await retrieve(ask(workspaceId, question));

    expect(evidence.slice(0, 6).map((e) => e.text)).toContain(owner);
    expect(similarity).toBeGreaterThanOrEqual(0.3);
  });

  it("finds facts of entities related within two hops, not three", async () => {
    const { vectors } = installStubModels();
    const question = "誰負責避免排放算法？";
    vectors.set(question, [1, 0]);
    for (const text of DISTRACTORS) vectors.set(text, [1, 0]);
    const hop0 = "「避免排放算法」屬於「減碳模組」";
    const hop1 = "「小林」負責「減碳模組」";
    const hop2 = "「小林」帶領「資料組」";
    const hop3 = "「資料組」使用「Postgres」";
    for (const text of [hop0, hop1, hop2, hop3]) vectors.set(text, [0, 1]);
    const workspaceId = await createWorkspace("guest", "test");
    await confirmLinked(workspaceId, hop0, hop1, hop2, hop3, ...DISTRACTORS);

    const { evidence } = await retrieve(ask(workspaceId, question));

    const texts = evidence.map((e) => e.text);
    expect(texts).toEqual(expect.arrayContaining([hop0, hop1, hop2]));
    expect(texts).not.toContain(hop3);
  });

  it("walks no relation a fact no longer current states", async () => {
    const { vectors } = installStubModels();
    const question = "誰負責避免排放算法？";
    vectors.set(question, [1, 0]);
    for (const text of DISTRACTORS) vectors.set(text, [1, 0]);
    const hop0 = "「避免排放算法」屬於「減碳模組」";
    const hop1 = "「小林」負責「減碳模組」";
    for (const text of [hop0, hop1]) vectors.set(text, [0, 1]);
    const workspaceId = await createWorkspace("guest", "test");
    const proposal = await confirmLinked(
      workspaceId,
      hop0,
      hop1,
      ...DISTRACTORS,
    );
    const ended = await propose(workspaceId, "user-a", {
      source: { kind: "message", content: "過時" },
      facts: [],
      corrections: [
        {
          kind: "obsolete",
          targetFactId: proposal.items[0].factId!,
          reason: "過時",
          effectiveAt: new Date().toISOString(),
        },
      ],
    });
    await confirmProposal(workspaceId, ended.id, "user-b");

    const { evidence } = await retrieve(ask(workspaceId, question));

    expect(evidence.map((e) => e.text)).not.toContain(hop1);
  });
});

describe("checkSubject", () => {
  const first = (message: string, attachments = 0) => ({
    turns: [],
    message,
    attachments,
  });

  it("asks Jev about a first question in the team wiki's context", async () => {
    const { jev } = installStubModels();
    jev.noul = 0.9;

    const out = await checkSubject(first("它的截止日是哪天？"));

    expect(out).toEqual({ clarify: true });
    const state = JSON.stringify(jev.states[0]);
    expect(state).toContain("它的截止日是哪天？");
    expect(state).toContain("團隊");
    expect(state).not.toContain("客服");
  });

  it.each([
    "記下：週會改到每週四下午",
    "幫我記下這件事，週會改到每週四",
    "更新一下，避免排放公式加上了壽命比 L",
    "請輸入以下會議結論",
    "新增一條：地圖可以用半徑篩選",
    "補充：試辦計畫已經結束",
  ])("skips Jev for a first message that inputs: %s", async (message) => {
    const { jev } = installStubModels();
    jev.noul = 0.9;

    const out = await checkSubject(first(message));

    expect(out).toEqual({ clarify: false });
    expect(jev.states).toEqual([]);
  });

  it("skips Jev for a first message with an attachment", async () => {
    const { jev } = installStubModels();
    jev.noul = 0.9;

    const out = await checkSubject(first("這是上週的會議紀錄", 1));

    expect(out).toEqual({ clarify: false });
    expect(jev.states).toEqual([]);
  });

  it("skips Jev for a follow-up", async () => {
    const { jev } = installStubModels();
    jev.noul = 0.9;

    const out = await checkSubject({
      ...first("它是哪年開始的？"),
      turns: [
        { role: "user", content: "避免排放怎麼算？" },
        { role: "assistant", content: "A = W × EF × R。[1]" },
      ],
    });

    expect(out).toEqual({ clarify: false });
    expect(jev.states).toEqual([]);
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

    expect(out.reply).toBe(
      "知識庫裡沒有這件事的資料。如果你知道，可以直接告訴我，我會整理成提案請團隊確認。",
    );
    expect(out.citations).toEqual([]);
    expect(chat.prompts).toEqual([]);
  });
});
