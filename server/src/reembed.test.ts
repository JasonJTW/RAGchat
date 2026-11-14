import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "./db.js";
import { facts } from "./db/schema.js";
import {
  confirmProposal,
  propose,
  searchChunks,
  searchFacts,
} from "./knowledge-base.js";
import { reembed } from "./reembed.js";
import { installStubModels } from "./stub-models.js";
import { createWorkspace } from "./workspaces.js";

// After EMBEDDING_MODEL changes, the rows embedded by the old model can't be
// compared and drop out of every search until `npm run reembed -w server`
// embeds them again.

const before = process.env.EMBEDDING_MODEL;
afterEach(() => {
  process.env.EMBEDDING_MODEL = before;
});

async function seeded() {
  const workspaceId = await createWorkspace("guest", "test");
  const proposal = await propose(workspaceId, "member-a", {
    source: {
      kind: "file",
      filename: "wiki.md",
      content: "# 算法\n\nR 是 0.7",
    },
    chunks: [
      { path: ["wiki.md", "算法"], content: "R 是 0.7", embedText: "x" },
    ],
    facts: [
      {
        content: "「取代率 R」是 0.7",
        chunk: 0,
        entities: [{ name: "取代率 R", kind: "other" }],
      },
    ],
  });
  await confirmProposal(workspaceId, proposal.id, "member-a");
  return workspaceId;
}

describe("reembed", () => {
  it("embeds the facts, passages, entities and aliases of another model again", async () => {
    const models = installStubModels();
    process.env.EMBEDDING_MODEL = "old-embedding";
    const workspaceId = await seeded();
    process.env.EMBEDDING_MODEL = "new-embedding";
    expect(await searchFacts(workspaceId, "取代率", 5)).toEqual([]);

    const counts = await reembed({ workspaceId });

    expect(counts).toEqual({ facts: 1, chunks: 1, entities: 1, aliases: 0 });
    expect(models.embedded["new-embedding"]).toEqual(
      expect.arrayContaining([
        "「取代率 R」是 0.7",
        "wiki.md › 算法\n\nR 是 0.7",
        "取代率 R",
      ]),
    );
    expect(await searchFacts(workspaceId, "取代率", 5)).toEqual([
      expect.objectContaining({ content: "「取代率 R」是 0.7" }),
    ]);
    expect(await searchChunks(workspaceId, "R 是 0.7", 5)).toHaveLength(1);
  });

  it("leaves a row embedded anew meanwhile (an edit) as the edit left it", async () => {
    installStubModels();
    process.env.EMBEDDING_MODEL = "old-embedding";
    const workspaceId = await seeded();
    process.env.EMBEDDING_MODEL = "new-embedding";
    const [fact] = await db
      .select({ id: facts.id })
      .from(facts)
      .where(eq(facts.workspaceId, workspaceId));
    const edited = new Array<number>(1536).fill(0);
    edited[1535] = 1;
    // While the batch is being embedded, a member's edit re-embeds the fact.
    const stubs = globalThis.MODEL_STUBS!;
    globalThis.MODEL_STUBS = {
      ...stubs,
      embeddings: (id) => {
        const real = stubs.embeddings(id);
        const embedDocuments = real.embedDocuments.bind(real);
        real.embedDocuments = async (texts) => {
          await db
            .update(facts)
            .set({
              content: "「取代率 R」是 0.8",
              embedding: edited,
              embeddingModel: "new-embedding",
            })
            .where(eq(facts.id, fact.id));
          return embedDocuments(texts);
        };
        return real;
      },
    };

    const counts = await reembed({ workspaceId });

    expect(counts.facts).toBe(0);
    const [match] = await searchFacts(
      workspaceId,
      { text: "x", vector: edited },
      1,
    );
    expect(match).toMatchObject({ content: "「取代率 R」是 0.8" });
    expect(match.similarity).toBeCloseTo(1);
  });

  it("leaves rows of the current model as they are", async () => {
    installStubModels();
    process.env.EMBEDDING_MODEL = "new-embedding";
    const workspaceId = await seeded();

    expect(await reembed({ workspaceId })).toEqual({
      facts: 0,
      chunks: 0,
      entities: 0,
      aliases: 0,
    });
  });
});
