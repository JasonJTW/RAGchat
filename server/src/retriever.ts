import { Document } from "@langchain/core/documents";
import {
  BaseRetriever,
  type BaseRetrieverInput,
} from "@langchain/core/retrievers";
import {
  embedQuestion,
  type FactMatch,
  type Question,
  searchChanges,
  searchFacts,
  searchGraph,
  searchKeyword,
} from "./knowledge-base.js";
import { type Period, periodAsked } from "./periods.js";

// 檢索: a question's confirmed facts from four lanes, fused by reciprocal
// rank (RRF). By default only current facts count; a question naming a past
// time (「三月時…」) is answered from the facts that held then.
//
//   向量 vector   most similar by embedding
//   關鍵字 keyword sharing the question's terms (pg_trgm): names, codes
//   圖 graph      of the entities the question names, up to two hops
//   時間 time     for a past period, those that began or ended in it

export type Lane = "vector" | "keyword" | "graph" | "time";

/** A fact the retriever found, as a Document's metadata. */
export type RetrievedFact = FactMatch & {
  /** Its rank (from 1) in each lane that found it. */
  lanes: Partial<Record<Lane, number>>;
  /** Its reciprocal rank fusion score. */
  score: number;
  /** Relations walked from an entity the question names (graph lane). */
  hops?: number;
  /** Its pg_trgm word similarity to the question (keyword lane). */
  keyword?: number;
  /**
   * The question names what it speaks of (an entity, or a Latin-script
   * name or code the fact has verbatim, e.g. 「EF-07」), so it covers the
   * question however their wording compares.
   */
  named: boolean;
};

export interface KnowledgeRetrieverInput extends BaseRetrieverInput {
  workspaceId: string;
  /** How many facts to return; 6 by default. */
  k?: number;
  /**
   * The time the facts must have held in. By default read from the
   * question (periods.ts); null: now, whatever the question says.
   */
  period?: Period | null;
  /** What "now" is when reading the question's period; for tests. */
  now?: Date;
}

// Facts each lane offers before fusion, and the RRF constant.
const CANDIDATES = 20;
const RRF_K = 60;
// A name or code in Latin script: two or more letters, digits and joiners
// with a letter among them (「EF-07」「CSV」「PR #128」 gives PR).
const TERM = /[A-Za-z0-9][\w.-]*[A-Za-z0-9]/g;

// The question's terms, lower-cased.
function termsOf(query: string): string[] {
  return [...query.normalize("NFKC").matchAll(TERM)]
    .map(([term]) => term.toLowerCase())
    .filter((term) => /[a-z]/.test(term));
}

/**
 * The knowledge base's confirmed facts best matching a question, as
 * Documents whose `pageContent` is the fact and `metadata` its
 * `RetrievedFact`, best first.
 */
export class KnowledgeRetriever extends BaseRetriever<RetrievedFact> {
  lc_namespace = ["ragchat", "retrievers"];
  private readonly workspaceId: string;
  private readonly k: number;
  private readonly period?: Period | null;
  private readonly now?: Date;

  constructor(fields: KnowledgeRetrieverInput) {
    super(fields);
    this.workspaceId = fields.workspaceId;
    this.k = fields.k ?? 6;
    this.period = fields.period;
    this.now = fields.now;
  }

  async _getRelevantDocuments(
    query: string,
  ): Promise<Document<RetrievedFact>[]> {
    return this.search(await embedQuestion(query));
  }

  /**
   * As `invoke`, for a question embedded already: its embedding is shared
   * by every lane, and by other searches the caller makes with it.
   */
  async search(question: Question): Promise<Document<RetrievedFact>[]> {
    const query = question.text;
    const during =
      this.period === undefined
        ? periodAsked(query, this.now ?? new Date())
        : (this.period ?? undefined);
    const ws = this.workspaceId;
    const terms = termsOf(query);
    const [vector, keyword, graph, time] = await Promise.all([
      searchFacts(ws, question, CANDIDATES, during),
      searchKeyword(ws, question, CANDIDATES, during),
      searchGraph(ws, question, CANDIDATES, during),
      during ? searchChanges(ws, question, CANDIDATES, during) : [],
    ]);
    const lanes: [Lane, FactMatch[]][] = [
      ["vector", vector],
      ["keyword", keyword],
      ["graph", graph],
      ["time", time],
    ];
    const fused = new Map<string, RetrievedFact>();
    for (const [lane, ranking] of lanes)
      ranking.forEach((match, rank) => {
        const fact = fused.get(match.id) ?? {
          ...match,
          lanes: {},
          score: 0,
          named: false,
        };
        fact.lanes[lane] = rank + 1;
        fact.score += 1 / (RRF_K + rank + 1);
        if ("hops" in match) {
          fact.hops = match.hops as number;
          fact.named = true;
        }
        if ("keyword" in match) {
          fact.keyword = match.keyword as number;
          // A keyword hit names the fact when it has a term of the question.
          const content = fact.content.normalize("NFKC").toLowerCase();
          if (terms.some((term) => content.includes(term))) fact.named = true;
        }
        fused.set(match.id, fact);
      });
    return [...fused.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, this.k)
      .map(
        (fact) => new Document({ pageContent: fact.content, metadata: fact }),
      );
  }
}
