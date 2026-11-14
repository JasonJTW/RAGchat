import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db.js";
import { conversations } from "./db/schema.js";
import type { Caller } from "./workspaces.js";

// 對話: each 成員's chat threads, saved as the UI messages the chat shows so
// an old one reopens as it was and can be continued. A conversation belongs
// to one caller (workspace and user); to anyone else it does not exist.

/** A conversation as the list shows it, newest first. */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** A saved conversation with its messages. */
export interface Conversation extends ConversationSummary {
  messages: unknown[];
}

const TITLE_LENGTH = 40;

/** The caller's conversations, most recently continued first. */
export async function listConversations(
  caller: Caller,
): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(owned(caller))
    .orderBy(desc(conversations.updatedAt));
  return rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** The caller's conversation, or undefined when it is not theirs. */
export async function readConversation(
  caller: Caller,
  id: string,
): Promise<Conversation | undefined> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), owned(caller)));
  return (
    row && {
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      messages: row.messages,
    }
  );
}

/**
 * Whether the caller may write to the conversation: it is theirs, or nobody
 * has started it yet.
 */
export async function mayContinue(caller: Caller, id: string) {
  const [row] = await db
    .select({
      workspaceId: conversations.workspaceId,
      userId: conversations.userId,
    })
    .from(conversations)
    .where(eq(conversations.id, id));
  return (
    !row ||
    (row.workspaceId === caller.workspaceId && row.userId === caller.userId)
  );
}

/**
 * Saves the conversation's messages, starting it if new; its title is the
 * first user message. An attached file is kept as its name and type only:
 * its contents became a 來源 when it was sent, and are never stored here.
 * Returns false, saving nothing, when it is someone else's.
 */
export async function saveConversation(
  caller: Caller,
  id: string,
  sent: { role: string; parts: { type: string; text?: string }[] }[],
): Promise<boolean> {
  const messages = sent.map((message) => ({
    ...message,
    parts: message.parts.map(withoutFileData),
  }));
  const saved = await db
    .insert(conversations)
    .values({
      id,
      ...caller,
      title: titleOf(messages),
      messages,
    })
    .onConflictDoUpdate({
      target: conversations.id,
      set: { messages, updatedAt: sql`now()` },
      setWhere: owned(caller),
    })
    .returning({ id: conversations.id });
  return saved.length > 0;
}

function owned(caller: Caller) {
  return and(
    eq(conversations.workspaceId, caller.workspaceId),
    eq(conversations.userId, caller.userId),
  );
}

function titleOf(
  messages: { role: string; parts: { type: string; text?: string }[] }[],
) {
  const first = messages.find((message) => message.role === "user");
  const text = (first?.parts ?? [])
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, TITLE_LENGTH).join("") || "新對話";
}

// A `file` part without its data URL: what the chat shows of it.
function withoutFileData<P extends { type: string }>(part: P) {
  if (part.type !== "file") return part;
  const { filename, mediaType } = part as P & {
    filename?: string;
    mediaType?: string;
  };
  return { type: "file", filename, mediaType };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Drops from the workspace's conversations every data part (proposal card,
 * citation) that mentions one of the ids, e.g. of a hard-deleted 來源's
 * facts. Their text parts stay as the member read them.
 */
export async function forgetParts(tx: Tx, workspaceId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: conversations.id, messages: conversations.messages })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        sql`${conversations.messages}::text ~ ${ids.join("|")}`,
      ),
    )
    .for("update");
  const mentions = (part: unknown) => {
    const json = JSON.stringify(part);
    return ids.some((id) => json.includes(id));
  };
  for (const row of rows) {
    const messages = (row.messages as { parts?: { type?: string }[] }[]).map(
      (message) => ({
        ...message,
        parts: (message.parts ?? []).filter(
          (part) => !(part.type?.startsWith("data-") && mentions(part)),
        ),
      }),
    );
    await tx
      .update(conversations)
      .set({ messages })
      .where(eq(conversations.id, row.id));
  }
}
