import { describe, expect, it } from "vitest";
import { propose as proposeFacts, searchFacts } from "../knowledge-base.js";
import { installStubModels } from "../stub-models.js";
import { createWorkspace } from "../workspaces.js";
import { extract, propose } from "./input.js";

const MESSAGE =
  "請把以下內容輸入到知識庫：我們目前的避免排放算法模型是 估算值 A = m × EF × 取代率 R × 壽命比 L";
const FACT =
  "我們目前的避免排放算法模型是 估算值 A = m × EF × 取代率 R × 壽命比 L";

describe("extract", () => {
  it("extracts the facts of the input, without the instruction to input them", async () => {
    const { chat } = installStubModels();
    chat.structured = () => ({ facts: [{ content: FACT }] });

    const out = await extract({ message: MESSAGE });

    expect(out).toEqual({ extracted: [FACT] });
    expect(chat.structuredPrompts).toHaveLength(1);
    expect(chat.structuredPrompts[0]).toContain(FACT);
    expect(chat.structuredPrompts[0]).not.toContain("請把以下內容輸入到知識庫");
  });

  it("drops blank facts", async () => {
    const { chat } = installStubModels();
    chat.structured = () => ({
      facts: [{ content: " " }, { content: "R 是取代率" }],
    });

    expect(await extract({ message: "記下：R 是取代率" })).toEqual({
      extracted: ["R 是取代率"],
    });
  });
});

describe("propose", () => {
  it("creates a pending proposal of the facts and shows it as a card", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    const written: unknown[] = [];

    const out = await propose(
      { workspaceId, userId: "user-a", message: MESSAGE, extracted: [FACT] },
      { writer: (chunk: unknown) => written.push(chunk) },
    );

    expect(out.proposal).toMatchObject({
      status: "pending",
      createdBy: "user-a",
      items: [{ kind: "add", content: FACT }],
    });
    expect(written).toContainEqual({
      type: "data-proposal",
      id: out.proposal!.id,
      data: out.proposal,
    });
    // The reply says so in words as well.
    expect(written).toContainEqual(
      expect.objectContaining({ type: "text-delta" }),
    );
  });

  it("leaves the knowledge base without the facts until the proposal is confirmed", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");

    await propose(
      { workspaceId, userId: "user-a", message: MESSAGE, extracted: [FACT] },
      {},
    );

    expect(await searchFacts(workspaceId, "避免排放怎麼算？", 5)).toEqual([]);
  });

  it("proposes nothing when no fact was extracted, and says so", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    const written: { type: string; delta?: string }[] = [];

    const out = await propose(
      { workspaceId, userId: "user-a", message: "記下：", extracted: [] },
      { writer: (chunk) => written.push(chunk) },
    );

    expect(out.proposal).toBeUndefined();
    expect(written.map((c) => c.delta ?? "").join("")).toContain("沒有");
  });

  it("tells which older pending items its confirmation would expire, as making the same claim", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    const older = await proposeFacts(workspaceId, "user-b", {
      source: { kind: "message", content: FACT },
      facts: [FACT, "M 代表質量，單位是公斤，由物資登記時填寫"],
    });
    const written: { type: string; delta?: string }[] = [];

    const out = await propose(
      { workspaceId, userId: "user-a", message: MESSAGE, extracted: [FACT] },
      { writer: (chunk) => written.push(chunk) },
    );

    expect(out.proposal?.expires).toEqual([
      {
        proposalId: older.id,
        itemId: older.items[0].id,
        kind: "add",
        content: FACT,
        createdBy: "user-b",
      },
    ]);
    expect(written.map((c) => c.delta ?? "").join("")).toContain(
      "確認後會讓 1 項較早的待確認項目過期",
    );
  });
});
