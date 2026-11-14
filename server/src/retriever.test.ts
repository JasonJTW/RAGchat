import { describe, expect, it } from "vitest";
import { linkEntities } from "./agent/link-entities.js";
import {
  confirmProposal,
  type FactDraft,
  propose,
  type Proposal,
} from "./knowledge-base.js";
import { KnowledgeRetriever, type RetrievedFact } from "./retriever.js";
import { installStubModels } from "./stub-models.js";
import { createWorkspace } from "./workspaces.js";

const NOW = new Date("2026-11-14T10:00:00+08:00");
const taipei = (date: string) => `${date}T00:00:00+08:00`;

const V1 = "避免排放公式為 A = W × EF × R";
const V2 = "避免排放公式為 A = W × EF × R × L";
const R = "取代率 R 所有類別統一為 0.7";

/** Confirms the facts as one proposal. */
async function confirmed(workspaceId: string, facts: FactDraft[]) {
  const proposal = await propose(workspaceId, "user-a", {
    source: { kind: "message", content: "記下" },
    facts,
  });
  await confirmProposal(workspaceId, proposal.id, "user-b");
  return proposal;
}

/** Confirms a 取代 of the item's fact, effective then. */
async function replace(
  workspaceId: string,
  item: Proposal["items"][number],
  content: string,
  effectiveAt: string,
) {
  const proposal = await propose(workspaceId, "user-a", {
    source: { kind: "message", content: "改了" },
    facts: [],
    corrections: [
      {
        kind: "supersede",
        targetFactId: item.factId!,
        content,
        reason: "加入壽命比",
        effectiveAt,
      },
    ],
  });
  await confirmProposal(workspaceId, proposal.id, "user-b");
}

/** The demo's formula: V1 from 2026-03-02, replaced by V2 on 2026-05-18. */
async function demoWorkspace() {
  const workspaceId = await createWorkspace("guest", "test");
  const { items } = await confirmed(workspaceId, [
    { content: V1, validFrom: taipei("2026-03-02") },
    { content: R, validFrom: taipei("2026-03-02") },
  ]);
  await replace(workspaceId, items[0], V2, taipei("2026-05-18"));
  return workspaceId;
}

async function retrieved(
  workspaceId: string,
  question: string,
  k = 6,
): Promise<RetrievedFact[]> {
  const retriever = new KnowledgeRetriever({ workspaceId, k, now: NOW });
  const documents = await retriever.invoke(question);
  return documents.map((d) => {
    expect(d.pageContent).toBe(d.metadata.content);
    return d.metadata;
  });
}

describe("KnowledgeRetriever", () => {
  it("keeps to current facts unless the question names a past time", async () => {
    installStubModels();
    const workspaceId = await demoWorkspace();

    const facts = await retrieved(workspaceId, "避免排放公式是什麼？");

    expect(facts.map((f) => f.content).sort()).toEqual([V2, R].sort());
    expect(facts.every((f) => f.validTo === undefined)).toBe(true);
  });

  it("answers a past time from the facts valid then, with what changed afterwards", async () => {
    installStubModels();
    const workspaceId = await demoWorkspace();

    const facts = await retrieved(
      workspaceId,
      "三月時我們的避免排放公式是什麼？",
    );

    expect(facts.map((f) => f.content).sort()).toEqual([V1, R].sort());
    const v1 = facts.find((f) => f.content === V1)!;
    expect(v1).toMatchObject({
      validFrom: new Date(taipei("2026-03-02")).toISOString(),
      validTo: new Date(taipei("2026-05-18")).toISOString(),
    });
    expect(v1.history?.map((h) => h.content)).toEqual([V1, V2]);
  });

  it("brings in a past period's fact that has since been replaced, however many facts of then are closer", async () => {
    const { vectors } = installStubModels();
    const question = "三月時我們的避免排放公式是什麼？";
    vectors.set(question, [1, 0, 0]);
    vectors.set(V1, [0.2, 1, 0]);
    vectors.set(V2, [0.2, 1, 0]);
    vectors.set(R, [0, 0, 1]);
    const closer = Array.from(
      { length: 12 },
      (_, i) => `我們三月時的避免排放公式備註 ${i}`,
    );
    closer.forEach((c, i) => vectors.set(c, [1, 0, 0.01 * i]));
    const workspaceId = await demoWorkspace();
    await confirmed(
      workspaceId,
      closer.map((content) => ({ content, validFrom: taipei("2026-03-01") })),
    );

    const facts = await retrieved(workspaceId, question);

    expect(facts).toHaveLength(6);
    const v1 = facts.find((f) => f.content === V1);
    expect(v1?.history?.map((h) => h.content)).toEqual([V1, V2]);
  });

  it("ranks first, in a time lane, the facts that began or ended in that time", async () => {
    const { vectors } = installStubModels();
    const question = "五月時 R 是多少？";
    vectors.set(question, [1, 0]);
    vectors.set(R, [1, 0]);
    vectors.set(V1, [0, 1]);
    vectors.set(V2, [0, 1]);
    const workspaceId = await demoWorkspace();

    const facts = await retrieved(workspaceId, question);

    // All three held in May; only the formula changed then.
    expect(facts.map((f) => f.content)).toHaveLength(3);
    expect(facts.find((f) => f.content === R)?.lanes.time).toBeUndefined();
    for (const content of [V1, V2])
      expect(facts.find((f) => f.content === content)?.lanes).toMatchObject({
        vector: expect.any(Number) as unknown,
        time: expect.any(Number) as unknown,
      });
    expect(facts.at(-1)?.content).toBe(R);
  });

  it("finds by keyword a code the vector lane ranks too low, fusing the lanes by reciprocal rank", async () => {
    const { vectors } = installStubModels();
    const question = "EF-07 的係數是多少？";
    const code = "類別 EF-07（家具）係數為 2.1";
    const others = Array.from({ length: 8 }, (_, i) => `週會第 ${i} 項`);
    vectors.set(question, [1, 0]);
    for (const text of others) vectors.set(text, [1, 0]);
    vectors.set(code, [0, 1]);
    const workspaceId = await createWorkspace("guest", "test");
    await confirmed(workspaceId, [code, ...others]);

    const facts = await retrieved(workspaceId, question);

    expect(facts).toHaveLength(6);
    expect(facts[0]).toMatchObject({
      content: code,
      named: true,
      lanes: { vector: 9, keyword: 1 },
    });
    expect(facts.slice(1).every((f) => !f.named && !f.lanes.keyword)).toBe(
      true,
    );
  });

  it("finds through the entity graph the facts of an entity the question names", async () => {
    const { vectors } = installStubModels();
    const question = "誰負責避免排放算法？";
    vectors.set(question, [1, 0]);
    const owner = "「林小樹」負責「避免排放算法」";
    vectors.set(owner, [0, 1]);
    const workspaceId = await createWorkspace("guest", "test");
    const [linked] = (
      await linkEntities({
        workspaceId,
        inputs: [{ facts: [{ content: owner }] }],
      })
    ).inputs;
    await confirmed(workspaceId, linked.facts);

    const [fact] = await retrieved(workspaceId, question);

    expect(fact).toMatchObject({
      content: owner,
      named: true,
      hops: 0,
      lanes: { graph: 1 },
    });
  });

  it("finds no fact of another workspace", async () => {
    installStubModels();
    await demoWorkspace();
    const empty = await createWorkspace("guest", "test");

    expect(await retrieved(empty, "避免排放公式是什麼？")).toEqual([]);
  });
});
