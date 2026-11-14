import { describe, expect, it } from "vitest";
import { confirmProposal, propose } from "../knowledge-base.js";
import { installStubModels } from "../stub-models.js";
import { createWorkspace } from "../workspaces.js";
import { inputFiles } from "./input.js";
import { type LinkedFact, linkEntities } from "./link-entities.js";

// [連結實體]: each fact's entities, linked to the workspace's existing ones
// or new. The stub model names an entity per 「…」 (see stub-models.ts).

const OWNER = "「避免排放算法」由「小林」負責";
const ALIASED = "「減碳計算模型」使用壽命比 L";

/** A workspace whose knowledge base holds OWNER, its entities linked. */
async function withOwner() {
  const workspaceId = await createWorkspace("guest", "test");
  const proposal = await propose(workspaceId, "user-a", {
    source: { kind: "message", content: OWNER },
    facts: [
      {
        content: OWNER,
        entities: [
          { name: "避免排放算法", kind: "method" },
          { name: "小林", kind: "person" },
        ],
        relations: [{ from: 1, relation: "負責", to: 0 }],
      },
    ],
  });
  await confirmProposal(workspaceId, proposal.id, "user-b");
  return { workspaceId, proposal };
}

const input = (...facts: string[]) => ({
  source: { kind: "message" as const, content: facts.join("\n") },
  chunks: [],
  facts: facts.map((content): LinkedFact => ({ content })),
});

describe("linkEntities", () => {
  it("links a mention named like an existing entity to it, without asking which", async () => {
    const { chat } = installStubModels();
    const { workspaceId, proposal } = await withOwner();

    const { inputs } = await linkEntities({
      workspaceId,
      inputs: [input("「小林」下週休假")],
    });

    const [kobayashi] = proposal.entities.filter((e) => e.name === "小林");
    expect(inputs[0].facts[0].entities).toEqual([
      { name: "小林", kind: "other", entityId: kobayashi.id },
    ]);
    expect(chat.structuredPrompts.join()).not.toContain("候選");
  });

  it("links a mention to the similar entity the model picks, or makes a new one", async () => {
    const { chat, vectors } = installStubModels();
    vectors.set("避免排放算法", [1, 0, 0]);
    vectors.set("減碳計算模型", [0.9, 0.1, 0]);
    vectors.set("壽命比", [0, 0, 1]);
    vectors.set("小林", [0, 1, 0]);
    const { workspaceId, proposal } = await withOwner();
    const structured = chat.structured;
    chat.structured = (text, name) =>
      name === "entity-link"
        ? { links: [{ mention: 1, entity: 1 }] }
        : structured(text, name);

    const { inputs } = await linkEntities({
      workspaceId,
      inputs: [input(ALIASED, "「壽命比」介於 0 到 1")],
    });

    const [algorithm] = proposal.entities.filter(
      (e) => e.name === "避免排放算法",
    );
    expect(inputs[0].facts.map((fact) => fact.entities)).toEqual([
      [{ name: "減碳計算模型", kind: "other", entityId: algorithm.id }],
      [{ name: "壽命比", kind: "other" }],
    ]);
    const asked = chat.structuredPrompts.at(-1)!;
    expect(asked).toContain("減碳計算模型");
    expect(asked).toContain("1. 避免排放算法");
    expect(asked).not.toContain("小林");
  });

  it("keeps the relations a fact states between its entities", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");

    const { inputs } = await linkEntities({
      workspaceId,
      inputs: [input("「王小明」負責「回收模組」")],
    });

    expect(inputs[0].facts[0]).toMatchObject({
      entities: [
        { name: "王小明", kind: "other" },
        { name: "回收模組", kind: "other" },
      ],
      relations: [{ from: 0, relation: "負責", to: 1 }],
    });
  });

  it("leaves an input without facts as it is, asking no model", async () => {
    const { chat } = installStubModels();
    const workspaceId = await createWorkspace("guest", "test");

    const { inputs } = await linkEntities({ workspaceId, inputs: [input()] });

    expect(inputs).toEqual([input()]);
    expect(chat.structuredPrompts).toEqual([]);
  });
});

describe("the 輸入 subgraph", () => {
  it("proposes each fact with its entities, marking the new ones with existing ones to relink to", async () => {
    const { vectors } = installStubModels();
    vectors.set("避免排放算法", [1, 0, 0]);
    vectors.set("減碳計算模型", [0.9, 0.1, 0]);
    vectors.set("小林", [0, 1, 0]);
    const { workspaceId, proposal: first } = await withOwner();
    const algorithm = first.entities.find((e) => e.name === "避免排放算法")!;
    const kobayashi = first.entities.find((e) => e.name === "小林")!;

    const { proposals } = await inputFiles(workspaceId, "user-a", [
      {
        filename: "notes.txt",
        bytes: Buffer.from("「減碳計算模型」由「小林」維護"),
      },
    ]);

    const [card] = proposals;
    const model = card.entities.find((e) => e.name === "減碳計算模型")!;
    expect(card.entities).toHaveLength(2);
    expect(card.entities).toEqual(
      expect.arrayContaining([
        {
          ...model,
          kind: "other",
          new: true,
          candidates: [{ id: algorithm.id, name: "避免排放算法" }],
        },
        { id: kobayashi.id, name: "小林", kind: "person", new: false },
      ]),
    );
    expect(card.items[0].entityIds?.sort()).toEqual(
      [model.id, kobayashi.id].sort(),
    );
  });
});

describe("a malformed model answer", () => {
  it("leaves the facts without entities rather than failing the input", async () => {
    const { chat } = installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    chat.structured = () => ({ nonsense: true });

    const { inputs } = await linkEntities({
      workspaceId,
      inputs: [input("「王小明」負責「回收模組」")],
    });

    expect(inputs[0].facts).toEqual([
      { content: "「王小明」負責「回收模組」" },
    ]);
  });
});
