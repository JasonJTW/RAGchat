import { sql, type SQL } from "drizzle-orm";
import { db, type Tx, isUuid } from "./db.js";
import { embeddings } from "./models.js";
import type { Period } from "./periods.js";

// 實體 and 別名: what facts speak of, under every name the team uses, and the
// relations facts state between them (edges). The knowledge base module
// stores a proposal's links through this one and asks it for the card's
// entities, a relinked entity at confirm, and the facts the graph reaches
// from a question.
//
// An entity lives while a pending or confirmed fact is linked to it (an
// alias while the fact that gave it does); others are pruned after each
// decision, so a rejected proposal leaves no entity behind.

/** An entity a fact speaks of, as the linker found it. */
export interface Mention {
  /** The name as the fact says it. */
  name: string;
  kind: string;
  /** The existing entity it means; absent for a new entity. */
  entityId?: string;
}

/** A relation a fact states, between two of its mentions (by index). */
export interface Relation {
  from: number;
  relation: string;
  to: number;
}

/** An existing entity, with its other names. */
export interface EntityRef {
  id: string;
  name: string;
  kind: string;
  aliases: string[];
}

/** An entity a proposal's facts speak of, as its card shows it. */
export interface ProposalEntity {
  id: string;
  name: string;
  kind: string;
  /** No confirmed fact speaks of it yet: the proposal makes it. */
  new: boolean;
  /**
   * For a new entity of a pending proposal: existing entities it may be
   * instead, most alike first; confirming can relink it to one of them.
   */
  candidates?: { id: string; name: string }[];
}

/** A member's call on the card: this new entity is that existing one. */
export interface Relink {
  entityId: string;
  to: string;
}

/** How alike (cosine) two names are when one may mean the other's entity. */
export const CANDIDATE_AT = 0.5;
const CANDIDATES = 5;

type Db = Tx | typeof db;

/** How names compare: trimmed, case and width folded. */
export const nameKey = (name: string) =>
  name.normalize("NFKC").trim().toLowerCase();

const LIVE_FACT = sql`('pending', 'confirmed')`;
const live = (entity: SQL) =>
  sql`exists (select 1 from fact_entities fe join facts f on f.id = fe.fact_id where fe.entity_id = ${entity} and f.status in ${LIVE_FACT})`;
const liveAlias = sql`exists (select 1 from facts af where af.id = a.fact_id and af.status in ${LIVE_FACT})`;

/**
 * For each name: the live entity it names exactly (its name or an alias),
 * else the live entities whose names are most alike, best first.
 */
export async function findEntities(
  workspaceId: string,
  names: string[],
): Promise<Map<string, { exact?: EntityRef; candidates: EntityRef[] }>> {
  const distinct = [...new Set(names)];
  const found = new Map<
    string,
    { exact?: EntityRef; candidates: EntityRef[] }
  >();
  if (!distinct.length) return found;
  const exact = await namedExactly(db, workspaceId, distinct.map(nameKey));
  const vague = distinct.filter((name) => !exact.has(nameKey(name)));
  const model = embeddings();
  const vectors = vague.length ? await model.embedDocuments(vague) : [];
  const alike = await Promise.all(
    vague.map((_, i) =>
      alikeEntities(db, workspaceId, vectors[i], model.model, []),
    ),
  );
  const refs = await refsOf(db, [
    ...exact.values(),
    ...alike.flat().map((row) => row.id),
  ]);
  for (const name of distinct) {
    const id = exact.get(nameKey(name));
    if (id) found.set(name, { exact: refs.get(id)!, candidates: [] });
  }
  vague.forEach((name, i) =>
    found.set(name, { candidates: alike[i].map((row) => refs.get(row.id)!) }),
  );
  return found;
}

// The live entity each name key names, by its name or a live alias.
async function namedExactly(
  tx: Db,
  workspaceId: string,
  keys: string[],
): Promise<Map<string, string>> {
  if (!keys.length) return new Map();
  const list = sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  );
  const { rows } = await tx.execute<{ key: string; id: string }>(sql`
    select key, id from (
      select lower(normalize(e.name, NFKC)) key, e.id, 0 rank, e.created_at
      from entities e where e.workspace_id = ${workspaceId}
      union all
      select lower(normalize(a.name, NFKC)), e.id, 1, e.created_at
      from entity_aliases a join entities e on e.id = a.entity_id
      where a.workspace_id = ${workspaceId} and ${liveAlias}
    ) named
    where key in (${list}) and ${live(sql`named.id`)}
    order by rank, created_at
  `);
  const byKey = new Map<string, string>();
  for (const row of rows) if (!byKey.has(row.key)) byKey.set(row.key, row.id);
  return byKey;
}

// Live entities whose name or a live alias is alike to the vector.
async function alikeEntities(
  tx: Db,
  workspaceId: string,
  vector: number[],
  model: string,
  except: string[],
): Promise<{ id: string; similarity: number }[]> {
  const v = JSON.stringify(vector);
  const excluded = except.length
    ? sql`and named.id not in (${sql.join(
        except.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const { rows } = await tx.execute<{ id: string; similarity: number }>(sql`
    select named.id, max(named.similarity) similarity from (
      select e.id, 1 - (e.embedding <=> ${v}::vector) similarity
      from entities e
      where e.workspace_id = ${workspaceId} and e.embedding_model = ${model}
      union all
      select a.entity_id, 1 - (a.embedding <=> ${v}::vector)
      from entity_aliases a
      where a.workspace_id = ${workspaceId} and a.embedding_model = ${model}
        and ${liveAlias}
    ) named
    where ${live(sql`named.id`)} ${excluded}
    group by named.id
    having max(named.similarity) >= ${CANDIDATE_AT}
    order by similarity desc
    limit ${CANDIDATES}
  `);
  return rows.map((row) => ({
    id: row.id,
    similarity: Number(row.similarity),
  }));
}

async function refsOf(tx: Db, ids: string[]): Promise<Map<string, EntityRef>> {
  const distinct = [...new Set(ids)];
  if (!distinct.length) return new Map();
  const { rows } = await tx.execute<{
    id: string;
    name: string;
    kind: string;
    aliases: string[] | null;
  }>(sql`
    select e.id, e.name, e.kind,
      array(select a.name from entity_aliases a
        where a.entity_id = e.id and ${liveAlias} order by a.name) aliases
    from entities e
    where e.id in (${sql.join(
      distinct.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        kind: row.kind,
        aliases: row.aliases ?? [],
      },
    ]),
  );
}

/**
 * Stores what each new fact speaks of: links to the existing entities its
 * mentions mean, new entities for the rest (one per name in a proposal),
 * the alias a mention gives an existing entity under another name, and the
 * fact's relations. A mention of an entity that is not a live one of the
 * workspace, or one named exactly like a live entity, links by name.
 * `vectorOf` gives each mention name's embedding.
 */
export async function linkFacts(
  tx: Tx,
  workspaceId: string,
  model: string,
  links: { factId: string; mentions: Mention[]; relations: Relation[] }[],
  vectorOf: (name: string) => number[],
): Promise<void> {
  const mentions = links.flatMap((link) => link.mentions);
  if (!mentions.length) return;
  const given = [
    ...new Set(mentions.flatMap((m) => (m.entityId ? [m.entityId] : []))),
  ];
  const liveGiven = await liveAmong(tx, workspaceId, given);
  const named = await namedExactly(tx, workspaceId, [
    ...new Set(mentions.map((m) => nameKey(m.name))),
  ]);
  // New entities, one per name key.
  const fresh = new Map<string, Mention>();
  const resolved = links.map((link) =>
    link.mentions.map((m) => {
      if (m.entityId && liveGiven.has(m.entityId)) return m.entityId;
      const id = named.get(nameKey(m.name));
      if (id) return id;
      if (!fresh.has(nameKey(m.name))) fresh.set(nameKey(m.name), m);
      return undefined;
    }),
  );
  const created = new Map<string, string>();
  if (fresh.size) {
    const { rows } = await tx.execute<{ id: string; name: string }>(sql`
      insert into entities (workspace_id, name, kind, embedding, embedding_model)
      values ${sql.join(
        [...fresh.values()].map(
          (m) =>
            sql`(${workspaceId}, ${m.name.trim()}, ${m.kind}, ${JSON.stringify(vectorOf(m.name))}::vector, ${model})`,
        ),
        sql`, `,
      )}
      returning id, name
    `);
    for (const row of rows) created.set(nameKey(row.name), row.id);
  }
  const ids = links.map((link, l) =>
    link.mentions.map(
      (m, i) => resolved[l][i] ?? created.get(nameKey(m.name))!,
    ),
  );
  // Aliases: an existing entity mentioned under a name it doesn't have yet.
  const refs = await refsOf(tx, ids.flat());
  const aliases = new Map<
    string,
    { entityId: string; name: string; factId: string; embedding: string }
  >();
  links.forEach((link, l) =>
    link.mentions.forEach((m, i) => {
      const ref = refs.get(ids[l][i])!;
      const key = nameKey(m.name);
      const known = [ref.name, ...ref.aliases].map(nameKey);
      if (!known.includes(key) && !aliases.has(`${ref.id} ${key}`))
        aliases.set(`${ref.id} ${key}`, {
          entityId: ref.id,
          name: m.name.trim(),
          factId: link.factId,
          embedding: JSON.stringify(vectorOf(m.name)),
        });
    }),
  );
  if (aliases.size)
    await insertAliases(tx, workspaceId, model, [...aliases.values()]);
  const pairs = links.flatMap((link, l) =>
    [...new Set(ids[l])].map((entityId) => ({ factId: link.factId, entityId })),
  );
  await tx.execute(sql`
    insert into fact_entities (workspace_id, fact_id, entity_id)
    values ${sql.join(
      pairs.map((p) => sql`(${workspaceId}, ${p.factId}, ${p.entityId})`),
      sql`, `,
    )}
    on conflict do nothing
  `);
  const edges = links.flatMap((link, l) =>
    link.relations.flatMap((r) => {
      const from = ids[l][r.from];
      const to = ids[l][r.to];
      return from && to && from !== to && r.relation.trim()
        ? [{ from, to, relation: r.relation.trim(), factId: link.factId }]
        : [];
    }),
  );
  if (edges.length)
    await tx.execute(sql`
      insert into edges (workspace_id, from_entity_id, to_entity_id, relation, fact_id)
      values ${sql.join(
        edges.map(
          (e) =>
            sql`(${workspaceId}, ${e.from}, ${e.to}, ${e.relation}, ${e.factId})`,
        ),
        sql`, `,
      )}
    `);
}

async function insertAliases(
  tx: Tx,
  workspaceId: string,
  model: string,
  aliases: {
    entityId: string;
    name: string;
    factId: string;
    embedding: string;
  }[],
) {
  await tx.execute(sql`
    insert into entity_aliases (workspace_id, entity_id, name, embedding, embedding_model, fact_id)
    values ${sql.join(
      aliases.map(
        (a) =>
          sql`(${workspaceId}, ${a.entityId}, ${a.name}, ${a.embedding}::vector, ${model}, ${a.factId})`,
      ),
      sql`, `,
    )}
  `);
}

/** Gives a replacement fact the entities of the fact it replaces. */
export async function inheritEntities(
  tx: Tx,
  workspaceId: string,
  pairs: { factId: string; fromFactId: string }[],
) {
  for (const { factId, fromFactId } of pairs)
    await tx.execute(sql`
      insert into fact_entities (workspace_id, fact_id, entity_id)
      select ${workspaceId}, ${factId}, entity_id from fact_entities
      where fact_id = ${fromFactId} and workspace_id = ${workspaceId}
      on conflict do nothing
    `);
}

/**
 * The entities each of the facts speaks of, and the entities of them all as
 * the card shows them; candidates only when `candidates` (the proposal is
 * pending).
 */
export async function entitiesOfFacts(
  tx: Db,
  workspaceId: string,
  factIds: string[],
  candidates: boolean,
): Promise<{ byFact: Map<string, string[]>; entities: ProposalEntity[] }> {
  if (!factIds.length) return { byFact: new Map(), entities: [] };
  const list = sql.join(
    factIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const { rows } = await tx.execute<{
    fact_id: string;
    id: string;
    name: string;
    kind: string;
    embedding: string;
    embedding_model: string;
    new: boolean;
  }>(sql`
    select fe.fact_id, e.id, e.name, e.kind, e.embedding::text embedding,
      e.embedding_model,
      not exists (select 1 from fact_entities o join facts f on f.id = o.fact_id
        where o.entity_id = e.id and f.status = 'confirmed') new
    from fact_entities fe join entities e on e.id = fe.entity_id
    where fe.workspace_id = ${workspaceId} and fe.fact_id in (${list})
    order by e.created_at, e.name
  `);
  const byFact = new Map<string, string[]>();
  const seen = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    byFact.set(row.fact_id, [...(byFact.get(row.fact_id) ?? []), row.id]);
    seen.set(row.id, row);
  }
  const fresh = [...seen.values()]
    .filter((row) => row.new)
    .map((row) => row.id);
  const entities: ProposalEntity[] = [];
  for (const row of seen.values()) {
    const entity: ProposalEntity = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      new: row.new,
    };
    if (candidates && row.new) {
      const alike = await alikeEntities(
        tx,
        workspaceId,
        JSON.parse(row.embedding) as number[],
        row.embedding_model,
        fresh,
      );
      const refs = await refsOf(
        tx,
        alike.map((a) => a.id),
      );
      entity.candidates = alike.map((a) => ({
        id: a.id,
        name: refs.get(a.id)!.name,
      }));
    }
    entities.push(entity);
  }
  return { byFact, entities };
}

/**
 * Relinks each new entity of the facts to the existing entity a member chose
 * instead: the facts speak of that one, their relations join it, and the
 * new entity's name becomes its alias. False, changing nothing, when an
 * entity is not a new one of the facts or the chosen one is not a live
 * entity of the workspace.
 */
export async function relink(
  tx: Tx,
  workspaceId: string,
  factIds: string[],
  relinks: Relink[],
): Promise<boolean> {
  if (!relinks.length) return true;
  const { entities } = await entitiesOfFacts(tx, workspaceId, factIds, false);
  const fresh = new Map(entities.filter((e) => e.new).map((e) => [e.id, e]));
  const liveIds = await liveAmong(
    tx,
    workspaceId,
    relinks.map((r) => r.to),
  );
  if (
    relinks.some(
      (r) =>
        !fresh.has(r.entityId) || !liveIds.has(r.to) || r.to === r.entityId,
    ) ||
    new Set(relinks.map((r) => r.entityId)).size !== relinks.length
  )
    return false;
  const facts = sql.join(
    factIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  for (const { entityId, to } of relinks) {
    await tx.execute(sql`
      insert into fact_entities (workspace_id, fact_id, entity_id)
      select workspace_id, fact_id, ${to} from fact_entities
      where entity_id = ${entityId} and fact_id in (${facts})
      on conflict do nothing
    `);
    await tx.execute(sql`
      delete from fact_entities where entity_id = ${entityId} and fact_id in (${facts})
    `);
    await tx.execute(sql`
      update edges set from_entity_id = ${to}
      where from_entity_id = ${entityId} and fact_id in (${facts})
    `);
    await tx.execute(sql`
      update edges set to_entity_id = ${to}
      where to_entity_id = ${entityId} and fact_id in (${facts})
    `);
    await tx.execute(sql`
      delete from edges where from_entity_id = to_entity_id and fact_id in (${facts})
    `);
    await tx.execute(sql`
      update entity_aliases set entity_id = ${to}
      where entity_id = ${entityId} and fact_id in (${facts})
    `);
    const ref = (await refsOf(tx, [to])).get(to)!;
    const name = fresh.get(entityId)!.name;
    if (![ref.name, ...ref.aliases].map(nameKey).includes(nameKey(name))) {
      const { rows } = await tx.execute<{
        embedding: string;
        embedding_model: string;
        fact_id: string;
      }>(sql`
        select e.embedding::text embedding, e.embedding_model, (
          select fe.fact_id from fact_entities fe
          where fe.entity_id = ${to} and fe.fact_id in (${facts}) limit 1
        ) fact_id
        from entities e where e.id = ${entityId}
      `);
      const [row] = rows;
      if (row?.fact_id)
        await insertAliases(tx, workspaceId, row.embedding_model, [
          { entityId: to, name, factId: row.fact_id, embedding: row.embedding },
        ]);
    }
  }
  return true;
}

/** Deletes the workspace's entities and aliases no live fact speaks of. */
export async function pruneEntities(tx: Tx, workspaceId: string) {
  await tx.execute(sql`
    delete from entity_aliases a
    where a.workspace_id = ${workspaceId} and not ${liveAlias}
  `);
  await tx.execute(sql`
    delete from entities e
    where e.workspace_id = ${workspaceId} and not ${live(sql`e.id`)}
  `);
}

/** The live entities named in the text, by their names or aliases. */
export async function entitiesNamedIn(
  workspaceId: string,
  text: string,
): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select distinct named.id from (
      select e.id, e.name from entities e where e.workspace_id = ${workspaceId}
      union all
      select a.entity_id, a.name from entity_aliases a
      where a.workspace_id = ${workspaceId} and ${liveAlias}
    ) named
    where length(named.name) > 0
      and strpos(lower(normalize(${text}, NFKC)), lower(normalize(named.name, NFKC))) > 0
      and ${live(sql`named.id`)}
  `);
  return rows.map((row) => row.id);
}

/** How far the graph is walked from the entities a question names. */
export const MAX_HOPS = 2;

/**
 * The current confirmed facts that speak of the given entities or of
 * entities related to them, up to two hops away through relations stated by
 * current confirmed facts; each with the fewest hops it was reached in. For
 * a past period, the facts and relations that held at some time in it.
 */
export async function graphFacts(
  workspaceId: string,
  seeds: string[],
  limit: number,
  during?: Period,
): Promise<{ factId: string; hops: number }[]> {
  if (!seeds.length) return [];
  // A relation holds while its fact does: now, or at some time in the period.
  const held = during
    ? sql`f.status = 'confirmed' and f.valid_from < ${during.to}
        and (f.valid_to is null or f.valid_to > ${during.from})`
    : sql`f.status = 'confirmed' and f.valid_to is null`;
  const { rows } = await db.execute<{ fact_id: string; hops: number }>(sql`
    with recursive current_edges as (
      select ed.from_entity_id a, ed.to_entity_id b from edges ed
      join facts f on f.id = ed.fact_id
      where ed.workspace_id = ${workspaceId}
        and ${held}
    ), walk (entity_id, hops) as (
      select id, 0 from entities
      where workspace_id = ${workspaceId} and id in (${sql.join(
        seeds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      union
      select case when ce.a = walk.entity_id then ce.b else ce.a end, walk.hops + 1
      from walk join current_edges ce on walk.entity_id in (ce.a, ce.b)
      where walk.hops < ${MAX_HOPS}
    ), reached as (
      select entity_id, min(hops) hops from walk group by entity_id
    )
    select fe.fact_id, min(reached.hops) hops
    from reached
    join fact_entities fe on fe.entity_id = reached.entity_id
    join facts f on f.id = fe.fact_id
    where ${held}
    group by fe.fact_id
    order by hops, fe.fact_id
    limit ${limit}
  `);
  return rows.map((row) => ({ factId: row.fact_id, hops: Number(row.hops) }));
}

// The ids among these that are live entities of the workspace.
async function liveAmong(
  tx: Db,
  workspaceId: string,
  ids: string[],
): Promise<Set<string>> {
  const valid = [...new Set(ids.filter(isUuid))];
  if (!valid.length) return new Set();
  const { rows } = await tx.execute<{ id: string }>(sql`
    select e.id from entities e
    where e.workspace_id = ${workspaceId}
      and e.id in (${sql.join(
        valid.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      and ${live(sql`e.id`)}
  `);
  return new Set(rows.map((row) => row.id));
}
