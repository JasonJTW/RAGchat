import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkEntities } from "./agent/link-entities.js";
import { type Proposal, propose, searchGraph } from "./knowledge-base.js";
import { installStubModels } from "./stub-models.js";
import { createWorkspace, type Caller } from "./workspaces.js";

// A proposal's entities at its decision, over HTTP: a member relinks a new
// entity to an existing one when confirming, and a rejected proposal
// leaves no entity of its own behind. Proposals are made through the
// knowledge base module, their entities named by the stub linker (「…」).

const caller = vi.hoisted(() => ({ current: undefined as unknown as Caller }));
vi.mock("./workspaces.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspaces.js")>()),
  callerOf: () => Promise.resolve(caller.current),
}));
const { app } = await import("./app.js");

const OWNER = "「小林」負責「避免排放算法」";
const ALIASED = "「減碳計算模型」使用壽命比 L";

let workspaceId: string;

async function proposeLinked(...contents: string[]): Promise<Proposal> {
  const [linked] = (
    await linkEntities({
      workspaceId,
      inputs: [{ facts: contents.map((content) => ({ content })) }],
    })
  ).inputs;
  return propose(workspaceId, "member-a", {
    source: { kind: "message", content: contents.join("\n") },
    facts: linked.facts,
  });
}

const confirm = (id: string, body: object = {}) =>
  request(app).post(`/api/proposals/${id}/confirm`).send(body);

const entity = (proposal: Proposal, name: string) =>
  proposal.entities.find((e) => e.name === name)!;

beforeEach(async () => {
  installStubModels();
  workspaceId = await createWorkspace("guest", "test");
  caller.current = { workspaceId, userId: "member-b" };
});

describe("confirming with a new entity relinked", () => {
  it("links its facts to the existing entity, its name kept as an alias", async () => {
    const first = await proposeLinked(OWNER);
    await confirm(first.id).expect(200);
    const algorithm = entity(first, "避免排放算法");
    const second = await proposeLinked(ALIASED);
    const model = entity(second, "減碳計算模型");
    expect(model.new).toBe(true);

    const res = await confirm(second.id, {
      relinks: [{ entityId: model.id, to: algorithm.id }],
    }).expect(200);

    const card = res.body as Proposal;
    expect(card.entities).toEqual([
      { id: algorithm.id, name: "避免排放算法", kind: "other", new: false },
    ]);
    expect(card.items[0].entityIds).toEqual([algorithm.id]);
    const found = await searchGraph(workspaceId, "減碳計算模型由誰負責？", 10);
    expect(found.map((f) => [f.content, f.hops])).toEqual(
      expect.arrayContaining([
        [ALIASED, 0],
        [OWNER, 0],
      ]),
    );
  });

  it("refuses a relink of an entity the proposal doesn't make, or to no live entity, and stays confirmable", async () => {
    const first = await proposeLinked(OWNER);
    await confirm(first.id).expect(200);
    const algorithm = entity(first, "避免排放算法");
    const second = await proposeLinked("「小林」也負責「減碳計算模型」");
    const kobayashi = entity(second, "小林");
    const model = entity(second, "減碳計算模型");

    for (const relinks of [
      [{ entityId: kobayashi.id, to: algorithm.id }],
      [{ entityId: model.id, to: "00000000-0000-4000-8000-000000000000" }],
      [{ entityId: model.id, to: model.id }],
      [{ entityId: model.id, to: "not-an-id" }],
    ])
      await confirm(second.id, { relinks }).expect(400);

    await confirm(second.id).expect(200);
  });
});

describe("rejecting a proposal", () => {
  it("leaves none of its new entities behind", async () => {
    const rejected = await proposeLinked("「回收模組」由「小王」維護");
    await request(app).post(`/api/proposals/${rejected.id}/reject`).expect(200);

    const later = await proposeLinked("「回收模組」上線了");

    expect(entity(later, "回收模組")).toMatchObject({ new: true });
    expect(entity(later, "回收模組").id).not.toBe(
      entity(rejected, "回收模組").id,
    );
    expect(await searchGraph(workspaceId, "小王", 10)).toEqual([]);
  });
});

describe("a 取代", () => {
  it("speaks of the entities of the fact it replaces", async () => {
    const first = await proposeLinked(OWNER);
    await confirm(first.id).expect(200);

    const replaced = await propose(workspaceId, "member-a", {
      source: { kind: "message", content: "改由小王負責" },
      facts: [],
      corrections: [
        {
          kind: "supersede",
          targetFactId: first.items[0].factId!,
          content: "小王負責避免排放算法",
          reason: "改由小王負責",
          effectiveAt: new Date().toISOString(),
        },
      ],
    });

    expect(replaced.items[0].entityIds?.sort()).toEqual(
      first.entities.map((e) => e.id).sort(),
    );
  });
});
