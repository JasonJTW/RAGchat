import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmProposal,
  currentFacts,
  propose as proposeFacts,
} from "../knowledge-base.js";
import { installStubModels } from "../stub-models.js";
import { createWorkspace } from "../workspaces.js";
import {
  compareConflicts,
  type CorrectionDraft,
  draftCorrection,
  locateTargets,
  proposeCorrection,
} from "./correct.js";

// The 修正 branch's nodes, each run alone on a state against the real
// database, with stub models.

let stubs: ReturnType<typeof installStubModels>;
let workspaceId: string;

beforeEach(async () => {
  stubs = installStubModels();
  workspaceId = await createWorkspace("guest", "test");
});

/** Confirms the facts into the workspace's knowledge base; returns their ids. */
async function known(...contents: string[]): Promise<string[]> {
  const proposal = await proposeFacts(workspaceId, "member-a", {
    source: { kind: "message", content: contents.join("。") },
    facts: contents,
  });
  await confirmProposal(workspaceId, proposal.id, "member-a");
  return proposal.items.map((item) => item.factId!);
}

describe("locateTargets", () => {
  it("puts the facts the last answer cited first, then the ones the message matches", async () => {
    stubs.vectors.set("R 代表取代率", [1, 0, 0]);
    stubs.vectors.set("L 代表壽命比", [0, 1, 0]);
    stubs.vectors.set("週會在週三", [0, 0, 1]);
    stubs.vectors.set("R 不是取代率，是回收率", [1, 0.1, 0]);
    const [r, l, meeting] = await known(
      "R 代表取代率",
      "L 代表壽命比",
      "週會在週三",
    );

    const { candidates } = await locateTargets({
      workspaceId,
      correction: "R 不是取代率，是回收率",
      cited: [meeting],
    });

    expect(candidates.map((c) => c.id)).toEqual([meeting, r, l]);
    expect(candidates[1]).toMatchObject({ content: "R 代表取代率" });
  });

  it("ignores cited ids that are not current facts of the workspace", async () => {
    const [r] = await known("R 代表取代率");
    workspaceId = await createWorkspace("guest", "other");
    const [mine] = await known("L 代表壽命比");

    const { candidates } = await locateTargets({
      workspaceId,
      correction: "L 不是壽命比，是使用年限比",
      cited: [r, "not-an-id", mine],
    });

    expect(candidates.map((c) => c.id)).toEqual([mine]);
  });

  it("finds nothing in an empty knowledge base", async () => {
    const { candidates } = await locateTargets({
      workspaceId,
      correction: "R 不是取代率，是回收率",
      cited: [],
    });

    expect(candidates).toEqual([]);
  });
});

describe("draftCorrection", () => {
  const R = {
    id: "00000000-0000-4000-8000-000000000001",
    content: "R 代表取代率",
    validFrom: "2026-10-01T00:00:00.000Z",
  };
  const L = {
    id: "00000000-0000-4000-8000-000000000002",
    content: "L 代表壽命比",
    validFrom: "2026-10-01T00:00:00.000Z",
  };

  it("drafts a 取代 of the fact the model names, with the reason and the date it took effect", async () => {
    stubs.chat.structured = () => ({
      corrections: [
        {
          fact: 2,
          kind: "supersede",
          content: "L 代表使用年限比",
          reason: "團隊改用使用年限比",
          effectiveDate: "2026-11-02",
        },
      ],
    });

    const { drafts } = await draftCorrection({
      correction: "L 上週一就改成使用年限比了",
      candidates: [R, L],
    });

    expect(drafts).toEqual([
      {
        kind: "supersede",
        target: L,
        content: "L 代表使用年限比",
        reason: "團隊改用使用年限比",
        // Midnight in Taiwan.
        effectiveAt: "2026-11-01T16:00:00.000Z",
      },
    ]);
    const [prompt] = stubs.chat.structuredPrompts;
    expect(prompt).toContain("[1] R 代表取代率");
    expect(prompt).toContain("[2] L 代表壽命比");
    expect(prompt).toContain("L 上週一就改成使用年限比了");
  });

  it("drafts 過時 without a replacement", async () => {
    stubs.chat.structured = () => ({
      corrections: [
        {
          fact: 1,
          kind: "obsolete",
          content: null,
          reason: "R 已不再使用",
          effectiveDate: null,
        },
      ],
    });
    const before = Date.now();

    const { drafts } = await draftCorrection({
      correction: "R 這個係數已經不再使用了",
      candidates: [R, L],
    });

    expect(drafts).toEqual([
      {
        kind: "obsolete",
        target: R,
        reason: "R 已不再使用",
        effectiveAt: expect.any(String) as unknown,
      },
    ]);
    // No date given: it takes effect now.
    expect(Date.parse(drafts[0].effectiveAt)).toBeGreaterThanOrEqual(before);
  });

  it("keeps the date between when the fact began to hold and now", async () => {
    stubs.chat.structured = () => ({
      corrections: [
        {
          fact: 1,
          kind: "obsolete",
          content: null,
          reason: "",
          effectiveDate: "2020-01-01",
        },
        {
          fact: 2,
          kind: "obsolete",
          content: null,
          reason: "",
          effectiveDate: "2999-01-01",
        },
      ],
    });
    const before = Date.now();

    const { drafts } = await draftCorrection({
      correction: "R 和 L 都過時了",
      candidates: [R, L],
    });

    expect(drafts[0].effectiveAt).toBe(R.validFrom);
    expect(Date.parse(drafts[1].effectiveAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(drafts[1].effectiveAt)).toBeLessThanOrEqual(Date.now());
    // No reason given: the member's message is the reason.
    expect(drafts[0].reason).toBe("R 和 L 都過時了");
  });

  it("drops what the model names outside the candidates, a 取代 with no new text, and a second change to one fact", async () => {
    stubs.chat.structured = () => ({
      corrections: [
        {
          fact: 3,
          kind: "obsolete",
          content: null,
          reason: "x",
          effectiveDate: null,
        },
        {
          fact: 0,
          kind: "obsolete",
          content: null,
          reason: "x",
          effectiveDate: null,
        },
        {
          fact: 1,
          kind: "supersede",
          content: " ",
          reason: "x",
          effectiveDate: null,
        },
        {
          fact: 2,
          kind: "supersede",
          content: "L 代表使用年限比",
          reason: "x",
          effectiveDate: "not a date",
        },
        {
          fact: 2,
          kind: "obsolete",
          content: null,
          reason: "x",
          effectiveDate: null,
        },
      ],
    });

    const { drafts } = await draftCorrection({
      correction: "L 改成使用年限比",
      candidates: [R, L],
    });

    expect(drafts).toEqual([
      expect.objectContaining({ kind: "supersede", target: L }),
    ]);
  });

  it("drafts nothing, without asking the model, when no fact could be meant", async () => {
    const { drafts } = await draftCorrection({
      correction: "R 不是取代率，是回收率",
      candidates: [],
    });

    expect(drafts).toEqual([]);
    expect(stubs.chat.structuredPrompts).toEqual([]);
  });
});

describe("compareConflicts", () => {
  async function draft(
    content: string,
    change: { kind: "supersede"; content: string } | { kind: "obsolete" },
  ): Promise<CorrectionDraft> {
    const [id] = await known(content);
    const [target] = await currentFacts(workspaceId, [id]);
    return {
      ...change,
      target,
      reason: "更正",
      effectiveAt: new Date().toISOString(),
    };
  }

  /** Proposes the drafts as `proposeCorrection` would; returns the proposal. */
  async function proposed(drafts: CorrectionDraft[]) {
    const { proposal } = await proposeCorrection({
      workspaceId,
      userId: "member-b",
      message: "更正",
      drafts,
      conflicts: [],
    });
    return proposal!;
  }

  it("keeps a change to a current fact, with no conflicts when nothing else changes it", async () => {
    const r = await draft("R 代表取代率", {
      kind: "supersede",
      content: "R 代表回收率",
    });

    expect(await compareConflicts({ workspaceId, drafts: [r] })).toEqual({
      drafts: [r],
      conflicts: [],
    });
  });

  it("drops a change to a fact that was replaced since, and a 取代 that leaves the text as it is", async () => {
    const replaced = await draft("R 代表取代率", {
      kind: "supersede",
      content: "R 代表回收率",
    });
    await confirmProposal(
      workspaceId,
      (await proposed([replaced])).id,
      "member-a",
    );
    const same = await draft("L 代表壽命比", {
      kind: "supersede",
      content: " L 代表壽命比 ",
    });

    const { drafts } = await compareConflicts({
      workspaceId,
      drafts: [replaced, same],
    });

    expect(drafts).toEqual([]);
  });

  it("lists the pending proposals that already change the same fact", async () => {
    const r = await draft("R 代表取代率", {
      kind: "supersede",
      content: "R 代表回收率",
    });
    const earlier = await proposed([{ ...r, kind: "obsolete" }]);

    const { conflicts } = await compareConflicts({ workspaceId, drafts: [r] });

    expect(conflicts).toEqual([
      {
        targetFactId: r.target.id,
        proposalId: earlier.id,
        itemId: earlier.items[0].id,
        kind: "obsolete",
        createdBy: "member-b",
      },
    ]);
  });
});

describe("proposeCorrection", () => {
  it("proposes the drafts and tells of the pending proposals that also change their facts", async () => {
    const [id] = await known("R 代表取代率");
    const [target] = await currentFacts(workspaceId, [id]);
    const draft: CorrectionDraft = {
      kind: "supersede",
      target,
      content: "R 代表回收率",
      reason: "更正",
      effectiveAt: new Date().toISOString(),
    };
    const written: { type: string; delta?: string; data?: unknown }[] = [];

    const { proposal } = await proposeCorrection(
      {
        workspaceId,
        userId: "member-b",
        message: "R 不是取代率，是回收率",
        drafts: [draft],
        conflicts: [
          {
            targetFactId: id,
            proposalId: "p",
            itemId: "i",
            kind: "obsolete",
            createdBy: "member-c",
          },
        ],
      },
      { writer: (chunk) => written.push(chunk) },
    );

    expect(proposal?.items).toEqual([
      expect.objectContaining({
        kind: "supersede",
        content: "R 代表回收率",
        target: expect.objectContaining({ factId: id }) as unknown,
      }),
    ]);
    const text = written.flatMap((c) => (c.delta ? [c.delta] : [])).join("");
    expect(text).toContain("1 項修正");
    expect(text).toContain("另有 1 則待確認提案也在修改這則事實");
    expect(written.some((c) => c.type === "data-proposal")).toBe(true);
  });

  it("tells which older pending items its confirmation would expire", async () => {
    const [id] = await known("R 代表取代率");
    const [target] = await currentFacts(workspaceId, [id]);
    const earlier = await proposeFacts(workspaceId, "member-c", {
      source: { kind: "message", content: "過時" },
      facts: [],
      corrections: [
        {
          kind: "obsolete",
          targetFactId: id,
          reason: "過時",
          effectiveAt: new Date().toISOString(),
        },
      ],
    });
    const written: { type: string; delta?: string }[] = [];

    const { proposal } = await proposeCorrection(
      {
        workspaceId,
        userId: "member-b",
        message: "R 不是取代率，是回收率",
        drafts: [
          {
            kind: "supersede",
            target,
            content: "R 代表回收率",
            reason: "更正",
            effectiveAt: new Date().toISOString(),
          },
        ],
        conflicts: [],
      },
      { writer: (chunk) => written.push(chunk) },
    );

    expect(proposal?.expires).toEqual([
      expect.objectContaining({
        proposalId: earlier.id,
        itemId: earlier.items[0].id,
        kind: "obsolete",
        content: "R 代表取代率",
      }),
    ]);
    expect(written.map((c) => c.delta ?? "").join("")).toContain(
      "確認後會讓 1 項較早的待確認項目過期",
    );
  });
});
