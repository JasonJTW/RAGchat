import { and, eq, ne, type SQL, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "./db.js";
import { entities, entityAliases, facts, sourceChunks } from "./db/schema.js";
import { embeddings } from "./models.js";

// `npm run reembed -w server`: after EMBEDDING_MODEL changes, embeds again
// every fact, passage, entity name and alias stored by another model. Rows
// are compared only with rows of the same model, so until then the old ones
// drop out of every search. Runs in batches, each committed: an interrupted
// run picks up where it stopped.

const BATCH = 100;

/** How many rows of each kind were embedded again. */
export interface Reembedded {
  facts: number;
  chunks: number;
  entities: number;
  aliases: number;
}

interface Embedded {
  table: PgTable;
  id: PgColumn;
  workspaceId: PgColumn;
  embeddingModel: PgColumn;
  /** The text that is embedded, as when the row was made. */
  text: SQL<string>;
}

const KINDS: Record<keyof Reembedded, Embedded> = {
  facts: { ...columns(facts), text: sql<string>`${facts.content}` },
  // A passage is embedded with its path first (source-files.ts).
  chunks: {
    ...columns(sourceChunks),
    text: sql<string>`array_to_string(${sourceChunks.path}, ' › ') || E'\\n\\n' || ${sourceChunks.content}`,
  },
  entities: { ...columns(entities), text: sql<string>`${entities.name}` },
  aliases: {
    ...columns(entityAliases),
    text: sql<string>`${entityAliases.name}`,
  },
};

function columns(
  table:
    typeof facts | typeof sourceChunks | typeof entities | typeof entityAliases,
) {
  return {
    table,
    id: table.id,
    workspaceId: table.workspaceId,
    embeddingModel: table.embeddingModel,
  };
}

/**
 * Embeds again, with EMBEDDING_MODEL, every row embedded by another model;
 * only the workspace's rows when given one.
 */
export async function reembed({
  workspaceId,
}: { workspaceId?: string } = {}): Promise<Reembedded> {
  const model = embeddings();
  const counts: Reembedded = { facts: 0, chunks: 0, entities: 0, aliases: 0 };
  for (const kind of Object.keys(KINDS) as (keyof Reembedded)[]) {
    const k = KINDS[kind];
    const stale = and(
      ne(k.embeddingModel, model.model),
      workspaceId ? eq(k.workspaceId, workspaceId) : undefined,
    );
    for (;;) {
      const rows = (await db
        .select({ id: k.id, text: k.text })
        .from(k.table)
        .where(stale)
        .limit(BATCH)) as { id: string; text: string }[];
      if (!rows.length) break;
      const vectors = await model.embedDocuments(rows.map((r) => r.text));
      await db.transaction(async (tx) => {
        for (const [i, row] of rows.entries())
          await tx
            .update(k.table)
            .set({
              embedding: vectors[i],
              embeddingModel: model.model,
            })
            .where(eq(k.id, row.id));
      });
      counts[kind] += rows.length;
    }
  }
  return counts;
}
