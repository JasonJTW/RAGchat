import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Proposal, propose, searchFacts } from "./knowledge-base.js";
import { installStubModels } from "./stub-models.js";
import { createWorkspace, type Caller } from "./workspaces.js";

// A proposal's life after it is made: any 成員 confirms or rejects it, every
// pending one is listed, confirming re-checks it against what changed since,
// and confirming expires the older pending items it covers. Proposals are
// made through the knowledge base module; the rest goes through HTTP.

const caller = vi.hoisted(() => ({ current: undefined as unknown as Caller }));
vi.mock("./workspaces.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspaces.js")>()),
  callerOf: () => Promise.resolve(caller.current),
}));
const { app } = await import("./app.js");

const TAKEN = "R 代表取代率";
const RECYCLED = "R 代表回收率";
const BY_WEIGHT = "取代率 R 以重量計算";
const MASS = "M 代表質量";

let workspaceId: string;
let vectors: Map<string, number[]>;

function as(userId: string) {
  caller.current = { workspaceId, userId };
}

function proposeFacts(userId: string, ...texts: string[]) {
  return propose(workspaceId, userId, {
    source: { kind: "message", content: texts.join("\n") },
    facts: texts,
  });
}

function proposeCorrection(
  userId: string,
  targetFactId: string,
  change: { content: string } | "obsolete",
) {
  return propose(workspaceId, userId, {
    source: { kind: "message", content: "更正" },
    facts: [],
    corrections: [
      {
        targetFactId,
        reason: "更正",
        effectiveAt: new Date().toISOString(),
        ...(change === "obsolete"
          ? { kind: "obsolete" as const }
          : { kind: "supersede" as const, content: change.content }),
      },
    ],
  });
}

function confirm(id: string, body: object = {}) {
  return request(app).post(`/api/proposals/${id}/confirm`).send(body);
}

/** Puts the text in the knowledge base; returns its fact's id. */
async function confirmed(text: string): Promise<string> {
  const proposal = await proposeFacts("member-a", text);
  expect((await confirm(proposal.id)).status).toBe(200);
  return proposal.items[0].factId!;
}

async function current(): Promise<string[]> {
  return (await searchFacts(workspaceId, TAKEN, 10))
    .map((fact) => fact.content)
    .sort();
}

beforeEach(async () => {
  ({ vectors } = installStubModels());
  workspaceId = await createWorkspace("guest", "test");
  as("member-a");
});

describe("any 成員", () => {
  it("confirms a proposal another member made, recorded as the confirmer", async () => {
    const proposal = await propose(workspaceId, "member-a", {
      source: { kind: "message", content: TAKEN },
      facts: [TAKEN],
    });
    as("member-b");

    const res = await request(app).post(
      `/api/proposals/${proposal.id}/confirm`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "confirmed",
      createdBy: "member-a",
      decidedBy: "member-b",
    });
    const [fact] = await searchFacts(workspaceId, TAKEN, 1);
    expect(fact).toMatchObject({
      content: TAKEN,
      createdBy: "member-a",
      confirmedBy: "member-b",
    });
  });
});

describe("GET /api/proposals", () => {
  it("lists every pending proposal of the workspace with who made it, oldest first", async () => {
    const first = await propose(workspaceId, "member-a", {
      source: { kind: "message", content: "M 代表質量" },
      facts: ["M 代表質量"],
    });
    const second = await propose(workspaceId, "member-b", {
      source: { kind: "message", content: "L 代表壽命比" },
      facts: ["L 代表壽命比"],
    });
    const decided = await propose(workspaceId, "member-b", {
      source: { kind: "message", content: TAKEN },
      facts: [TAKEN],
    });
    await request(app).post(`/api/proposals/${decided.id}/reject`);
    const otherWorkspace = await createWorkspace("guest", "other");
    await propose(otherWorkspace, "member-c", {
      source: { kind: "message", content: "EF 代表排放係數" },
      facts: ["EF 代表排放係數"],
    });

    const res = await request(app).get("/api/proposals");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: first.id,
        status: "pending",
        createdBy: "member-a",
        items: [expect.objectContaining({ content: "M 代表質量" })],
      }),
      expect.objectContaining({ id: second.id, createdBy: "member-b" }),
    ]);
  });
});

describe("confirming after the knowledge base changed", () => {
  beforeEach(() => {
    // TAKEN and RECYCLED make the same claim (what R stands for);
    // BY_WEIGHT is about R too, another claim; MASS is about something else.
    vectors.set(TAKEN, [1, 0, 0, 0]);
    vectors.set(RECYCLED, [0.94, 0.34, 0, 0]);
    vectors.set(BY_WEIGHT, [0.82, 0, 0.57, 0]);
    vectors.set(MASS, [0, 0, 0, 1]);
  });

  it("is stopped, showing the change made since, when its target was replaced", async () => {
    const taken = await confirmed(TAKEN);
    const replace = await proposeCorrection("member-a", taken, {
      content: RECYCLED,
    });
    const obsolete = await proposeCorrection("member-b", taken, "obsolete");
    await confirm(replace.id);
    as("member-b");

    const res = await confirm(obsolete.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: expect.any(String) as unknown,
      conflicts: [
        {
          itemId: obsolete.items[0].id,
          changeId: replace.items[0].id,
          kind: "supersede",
          before: TAKEN,
          after: RECYCLED,
          decidedBy: "member-a",
          decidedAt: expect.any(String) as unknown,
        },
      ],
    });
    expect(await current()).toEqual([RECYCLED]);
  });

  it("is stopped when a fact about the same thing was confirmed since", async () => {
    const taken = await confirmed(TAKEN);
    const note = await proposeFacts("member-b", BY_WEIGHT);
    const replace = await proposeCorrection("member-a", taken, {
      content: RECYCLED,
    });
    await confirm(replace.id);

    const res = await confirm(note.id);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      conflicts: [
        {
          itemId: note.items[0].id,
          changeId: replace.items[0].id,
          before: TAKEN,
          after: RECYCLED,
        },
      ],
    });
    expect(await current()).toEqual([RECYCLED]);
  });

  describe("with the server's clock off from the database's", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is not stopped by a change confirmed before it was made (server clock ahead)", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 3_600_000 });
      const taken = await confirmed(TAKEN);
      const replace = await proposeCorrection("member-a", taken, {
        content: RECYCLED,
      });
      expect((await confirm(replace.id)).status).toBe(200);
      const note = await proposeFacts("member-b", BY_WEIGHT);

      const res = await confirm(note.id);

      expect(res.status).toBe(200);
    });

    it("is stopped by a change confirmed after it was made (server clock behind)", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 3_600_000 });
      const taken = await confirmed(TAKEN);
      const note = await proposeFacts("member-b", BY_WEIGHT);
      const replace = await proposeCorrection("member-a", taken, {
        content: RECYCLED,
      });
      await confirm(replace.id);

      const res = await confirm(note.id);

      expect(res.status).toBe(409);
    });
  });

  it("goes through when what changed since is about something else", async () => {
    const note = await proposeFacts("member-b", BY_WEIGHT);
    await confirmed(MASS);

    const res = await confirm(note.id);

    expect(res.status).toBe(200);
  });

  it("can still be rejected", async () => {
    const taken = await confirmed(TAKEN);
    const replace = await proposeCorrection("member-a", taken, {
      content: RECYCLED,
    });
    const obsolete = await proposeCorrection("member-b", taken, "obsolete");
    await confirm(replace.id);
    expect((await confirm(obsolete.id)).status).toBe(409);

    const res = await request(app).post(`/api/proposals/${obsolete.id}/reject`);

    expect(res.status).toBe(200);
    expect(await current()).toEqual([RECYCLED]);
  });

  it("goes through once the member confirms anyway, applying the change to the fact now in the target's place", async () => {
    const taken = await confirmed(TAKEN);
    const replace = await proposeCorrection("member-a", taken, {
      content: RECYCLED,
    });
    const obsolete = await proposeCorrection("member-b", taken, "obsolete");
    await confirm(replace.id);
    const stopped = await confirm(obsolete.id);
    const seen = (
      stopped.body as { conflicts: { changeId: string }[] }
    ).conflicts.map((c) => c.changeId);

    const res = await confirm(obsolete.id, { acknowledged: seen });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "confirmed",
      items: [{ kind: "obsolete", target: { content: RECYCLED } }],
    });
    expect(await current()).toEqual([]);
  });

  it("is stopped again by a change the member has not seen", async () => {
    const taken = await confirmed(TAKEN);
    const note = await proposeFacts("member-b", BY_WEIGHT);
    const replace = await proposeCorrection("member-a", taken, {
      content: RECYCLED,
    });
    await confirm(replace.id);
    const seen = (
      (await confirm(note.id)).body as { conflicts: { changeId: string }[] }
    ).conflicts.map((c) => c.changeId);
    const recycled = replace.items[0].factId!;
    const back = await proposeCorrection("member-a", recycled, {
      content: TAKEN,
    });
    await confirm(back.id);

    const res = await confirm(note.id, { acknowledged: seen });

    expect(res.status).toBe(409);
    expect(
      (res.body as { conflicts: { changeId: string }[] }).conflicts.map(
        (c) => c.changeId,
      ),
    ).toContain(back.items[0].id);
  });

  it("lets only one of two members confirming rival proposals at once succeed", async () => {
    const taken = await confirmed(TAKEN);
    const replace = await proposeCorrection("member-a", taken, {
      content: RECYCLED,
    });
    const obsolete = await proposeCorrection("member-b", taken, "obsolete");

    const statuses = (
      await Promise.all([confirm(replace.id), confirm(obsolete.id)])
    ).map((res) => res.status);

    expect(statuses.sort()).toEqual([200, 409]);
  });

  it("lets only one of two rival new facts confirmed at once succeed", async () => {
    const first = await proposeFacts("member-a", TAKEN);
    const second = await proposeFacts("member-b", RECYCLED);

    const statuses = (
      await Promise.all([confirm(first.id), confirm(second.id)])
    ).map((res) => res.status);

    expect(statuses.sort()).toEqual([200, 409]);
    expect((await current()).length).toBe(1);
  });
});

describe("confirming a newer proposal", () => {
  beforeEach(() => {
    vectors.set(TAKEN, [1, 0, 0, 0]);
    vectors.set(RECYCLED, [0.94, 0.34, 0, 0]);
    vectors.set(BY_WEIGHT, [0.82, 0, 0.57, 0]);
    vectors.set(MASS, [0, 0, 0, 1]);
  });

  it("expires, item by item, the older pending items making the same claim, listed on its card beforehand", async () => {
    const older = await proposeFacts("member-a", TAKEN, MASS);
    const other = await proposeFacts("member-a", BY_WEIGHT);
    const newer = await proposeFacts("member-b", RECYCLED);
    const taken = older.items.find((item) => item.content === TAKEN)!;

    const [listed] = (
      (await request(app).get("/api/proposals")).body as Proposal[]
    ).filter((p) => p.id === newer.id);
    expect(listed.expires).toEqual([
      {
        proposalId: older.id,
        itemId: taken.id,
        kind: "add",
        content: TAKEN,
        createdBy: "member-a",
      },
    ]);

    expect((await confirm(newer.id)).status).toBe(200);

    const pending = (await request(app).get("/api/proposals"))
      .body as Proposal[];
    expect(pending.map((p) => p.id)).toEqual([older.id, other.id]);
    expect(pending[0].items).toEqual([
      expect.objectContaining({ content: TAKEN, expiredBy: newer.id }),
      expect.not.objectContaining({ expiredBy: expect.anything() as unknown }),
    ]);
    // Confirming the older one now adds only its live item.
    expect((await confirm(older.id)).status).toBe(200);
    expect(await current()).toEqual([MASS, RECYCLED].sort());
  });

  describe("whose facts speak of entities", () => {
    const about = (content: string, entity: string) =>
      propose(workspaceId, "member-a", {
        source: { kind: "message", content },
        facts: [{ content, entities: [{ name: entity, kind: "method" }] }],
      });

    it("expires an older item making the same claim about the same entity", async () => {
      const older = await about(TAKEN, "避免排放算法");
      const newer = await about(RECYCLED, "避免排放算法");

      expect(newer.expires).toEqual([
        expect.objectContaining({ itemId: older.items[0].id }),
      ]);
      expect((await confirm(newer.id)).status).toBe(200);
      const pending = (await request(app).get("/api/proposals"))
        .body as Proposal[];
      expect(pending.map((p) => p.id)).not.toContain(older.id);
    });

    it("expires no older item making an alike claim about another entity", async () => {
      const older = await about(TAKEN, "避免排放算法");
      const newer = await about(RECYCLED, "運送排放算法");

      expect(newer.expires).toEqual([]);
      expect((await confirm(newer.id)).status).toBe(200);
      const pending = (await request(app).get("/api/proposals"))
        .body as Proposal[];
      expect(pending.map((p) => p.id)).toEqual([older.id]);
    });
  });

  it("expires an older proposal whole when it covers every item, and leaves newer ones pending", async () => {
    const taken = await confirmed(TAKEN);
    const older = await proposeCorrection("member-a", taken, "obsolete");
    const replace = await proposeCorrection("member-b", taken, {
      content: RECYCLED,
    });
    const newer = await proposeFacts("member-a", RECYCLED);

    expect((await confirm(replace.id)).status).toBe(200);

    const pending = (await request(app).get("/api/proposals"))
      .body as Proposal[];
    expect(pending.map((p) => p.id)).toEqual([newer.id]);
    const res = await confirm(older.id);
    expect(res.status).toBe(409);
  });
});

describe("confirming with items unticked", () => {
  const WAREHOUSE = "倉庫在三樓";

  beforeEach(() => {
    vectors.set(TAKEN, [1, 0, 0, 0, 0]);
    vectors.set(RECYCLED, [0.94, 0.34, 0, 0, 0]);
    vectors.set(BY_WEIGHT, [0.82, 0, 0.57, 0, 0]);
    vectors.set(MASS, [0, 0, 0, 1, 0]);
    vectors.set(WAREHOUSE, [0, 0, 0, 0, 1]);
  });

  const itemOf = (proposal: Proposal, content: string) =>
    proposal.items.find((item) => item.content === content)!;

  it("expires no older pending item for an unticked one", async () => {
    const older = await proposeFacts("member-a", TAKEN, MASS);
    const newer = await proposeFacts("member-b", RECYCLED, WAREHOUSE);

    const res = await confirm(newer.id, {
      excluded: [itemOf(newer, RECYCLED).id],
    });

    expect(res.status).toBe(200);
    expect((res.body as Proposal).items).toEqual([
      expect.objectContaining({ content: RECYCLED, status: "rejected" }),
      expect.objectContaining({ content: WAREHOUSE, status: "confirmed" }),
    ]);
    const pending = (await request(app).get("/api/proposals"))
      .body as Proposal[];
    expect(pending.map((p) => p.id)).toEqual([older.id]);
    for (const item of pending[0].items)
      expect(item).not.toHaveProperty("expiredBy");
    // Ticked, the same confirmation would have expired the older TAKEN.
    expect((await confirm(older.id)).status).toBe(200);
    expect(await current()).toEqual([MASS, TAKEN, WAREHOUSE].sort());
  });

  it("is not stopped by a change since that touches only an unticked item", async () => {
    const taken = await confirmed(TAKEN);
    const note = await proposeFacts("member-b", BY_WEIGHT, WAREHOUSE);
    const replace = await proposeCorrection("member-a", taken, {
      content: RECYCLED,
    });
    await confirm(replace.id);

    const res = await confirm(note.id, {
      excluded: [itemOf(note, BY_WEIGHT).id],
    });

    expect(res.status).toBe(200);
    expect(await current()).toEqual([RECYCLED, WAREHOUSE].sort());
  });

  it("does not count an unticked item of a later confirmation as a change since", async () => {
    const older = await proposeFacts("member-a", BY_WEIGHT);
    const newer = await proposeFacts("member-b", RECYCLED, WAREHOUSE);
    await confirm(newer.id, { excluded: [itemOf(newer, RECYCLED).id] });

    // RECYCLED is about R too (cosine ≈ 0.77): ticked, it would stop this.
    const res = await confirm(older.id);

    expect(res.status).toBe(200);
  });

  it("rolls the unticking back when the confirmation is stopped", async () => {
    const taken = await confirmed(TAKEN);
    const note = await proposeFacts("member-b", BY_WEIGHT, WAREHOUSE);
    const replace = await proposeCorrection("member-a", taken, {
      content: RECYCLED,
    });
    await confirm(replace.id);

    const stopped = await confirm(note.id, {
      excluded: [itemOf(note, WAREHOUSE).id],
    });
    expect(stopped.status).toBe(409);

    const [pending] = (
      (await request(app).get("/api/proposals")).body as Proposal[]
    ).filter((p) => p.id === note.id);
    expect(pending.items.map((item) => item.status)).toEqual([
      "pending",
      "pending",
    ]);
  });
});
