import { randomUUID } from "node:crypto";
import type { Response } from "express";
// The AI SDK only speaks the UI message stream useChat reads; the agent's
// nodes write its chunks (agent/state.ts).
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { agent } from "./agent/graph.js";
import type { Upload } from "./agent/input.js";
import type { Turn } from "./agent/state.js";
import { saveConversation } from "./conversations.js";
import {
  DeidentificationUnavailable,
  pseudonymize,
  pseudonymizeKnown,
  type Reidentifier,
  reidentifier,
  UNAVAILABLE_REPLY,
} from "./pseudonyms.js";
import { containsSecret, SECRET_REFUSAL } from "./secrets.js";
import type { Caller } from "./workspaces.js";

export type { Citation } from "./agent/ask.js";

/** The parts of an AI SDK UIMessage the chat reads. */
export interface ChatMessage {
  role: string;
  parts: {
    type: string;
    text?: string;
    data?: unknown;
    filename?: string;
    url?: string;
  }[];
}

const DATA_URL = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]*)$/;

/**
 * The files the latest user message attaches (AI SDK `file` parts, data
 * URLs), or "invalid" when one is not a base64 data URL. Earlier messages'
 * files were read when they were sent and are ignored.
 */
export function attachedFiles(messages: ChatMessage[]): Upload[] | "invalid" {
  const latest = messages.at(-1);
  if (latest?.role !== "user") return [];
  const files: Upload[] = [];
  for (const part of latest.parts) {
    if (part.type !== "file") continue;
    const data = DATA_URL.exec(part.url ?? "");
    if (!data) return "invalid";
    files.push({
      filename: part.filename || "附件",
      bytes: Buffer.from(data[1], "base64"),
    });
  }
  return files;
}

/**
 * Runs the agent on the latest user message and its attached files, and
 * streams its reply: an answer with citations, or proposal cards for input or
 * a correction. With a conversation id, the messages and the reply are saved
 * as the caller's conversation before the response ends (also when the
 * client leaves mid-reply), attached files reduced to their names (see
 * conversations.ts); the caller must be allowed to continue it.
 *
 * This is where de-identification (ADR-0004) wraps the agent: the agent
 * gets the conversation with its sensitive values pseudonymised, its reply
 * gets the real values back as it streams, and the conversation is saved
 * pseudonymised. A latest message holding a secret is refused before any of
 * that; an earlier one (still in the client's history) is blanked.
 */
export async function streamReply(
  res: Response,
  caller: Caller,
  sent: ChatMessage[],
  files: Upload[],
  conversationId?: string,
) {
  const { messages, refused } = await withoutSecrets(sent);
  const turns = textTurns(messages);
  const message = turns.at(-1)?.role === "user" ? turns.pop()!.content : "";
  const attachments = files.length;
  const cited = citedFacts(messages);
  const { workspaceId } = caller;
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const abort = new AbortController();
      // A client that leaves stops the reply too (after a full reply, a no-op).
      res.once("close", () => abort.abort());
      writer.write({ type: "start" });
      const reply = (text: string) => {
        writer.write({ type: "text-start", id: "reply" });
        writer.write({ type: "text-delta", id: "reply", delta: text });
        writer.write({ type: "text-end", id: "reply" });
        writer.write({ type: "finish" });
      };
      if (refused) return reply(SECRET_REFUSAL);
      let safe: string[];
      let reid: Reidentifier;
      try {
        // The files' names too: a file refused before [去識別] (format,
        // size) keeps its name in the reply and the saved conversation,
        // which are pseudonymised only for values already known.
        [safe, reid] = await Promise.all([
          pseudonymize(workspaceId, [
            ...files.map((file) => file.filename),
            ...turns.map((t) => t.content),
            message,
          ]).then((all) => all.slice(files.length)),
          reidentifier(workspaceId),
        ]);
      } catch (error) {
        if (!(error instanceof DeidentificationUnavailable)) throw error;
        console.error(error);
        return reply(UNAVAILABLE_REPLY);
      }
      try {
        for await (const chunk of await agent.stream(
          {
            ...caller,
            turns: turns.map((t, i) => ({ ...t, content: safe[i] })),
            message: safe.at(-1)!,
            attachments,
            files,
            cited,
          },
          { streamMode: "custom", signal: abort.signal },
        ))
          for (const out of await reidentified(chunk as UIMessageChunk, reid))
            writer.write(out);
      } catch (error) {
        // The client left mid-reply: nobody reads the rest, and it's no failure.
        if (abort.signal.aborted) return;
        throw error;
      }
      writer.write({ type: "finish" });
    },
    onError: (error) => {
      console.error("chat failed:", error);
      return "回答時發生錯誤，請稍後再試。";
    },
    ...(conversationId && {
      originalMessages: messages as UIMessage[],
      generateId: randomUUID,
      onEnd: async ({ messages: all }) => {
        try {
          await saveConversation(
            caller,
            conversationId,
            await pseudonymizeKnown(workspaceId, all),
          );
        } catch (error) {
          // Never saved in the clear.
          if (!(error instanceof DeidentificationUnavailable)) throw error;
          console.error("conversation not saved:", error);
        }
      },
    }),
  });
  return pipeUIMessageStreamToResponse({
    response: res,
    stream,
    // Stops the Next.js rewrite proxy from gzipping the stream, which buffers
    // it until the answer is complete.
    headers: { "Cache-Control": "no-cache, no-transform" },
  });
}

/** What a user message holding a secret is shown as once refused. */
export const SECRET_REMOVED = "（已移除：這則訊息含有密碼或 API key）";

// The messages with each user message that holds a secret blanked, and
// whether the latest one did.
async function withoutSecrets(
  messages: ChatMessage[],
): Promise<{ messages: ChatMessage[]; refused: boolean }> {
  const secret = await Promise.all(
    messages.map((m) =>
      m.role === "user"
        ? containsSecret(
            m.parts
              .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
              .join("\n"),
          )
        : Promise.resolve(false),
    ),
  );
  return {
    messages: messages.map((m, i) =>
      secret[i]
        ? {
            ...m,
            parts: m.parts.map((p) =>
              p.type === "text" ? { ...p, text: SECRET_REMOVED } : p,
            ),
          }
        : m,
    ),
    refused: secret.at(-1) ?? false,
  };
}

// A chunk of the agent's reply with the real values back. A text part's
// deltas may hold a pseudonym back until it is whole; its end lets it out.
async function reidentified(
  chunk: UIMessageChunk,
  reid: Reidentifier,
): Promise<UIMessageChunk[]> {
  if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
    const delta = await reid.text(chunk.id, chunk.delta);
    return delta ? [{ ...chunk, delta }] : [];
  }
  if (chunk.type === "text-end" || chunk.type === "reasoning-end") {
    const rest = await reid.end(chunk.id);
    const type = chunk.type === "text-end" ? "text-delta" : "reasoning-delta";
    return rest ? [{ type, id: chunk.id, delta: rest }, chunk] : [chunk];
  }
  return [await reid.value(chunk)];
}

// The ids of the facts the latest answer cited, as its citation parts came
// back from the client: unchecked, so the agent keeps only current facts of
// the caller's workspace.
function citedFacts(messages: ChatMessage[]): string[] {
  const answer = [...messages].reverse().find((m) => m.role === "assistant");
  return (answer?.parts ?? []).flatMap((part) => {
    const data = part.data as { kind?: unknown; id?: unknown } | undefined;
    return part.type === "data-citation" &&
      data?.kind === "fact" &&
      typeof data.id === "string"
      ? [data.id]
      : [];
  });
}

// The conversation as plain-text turns; citations and other parts dropped.
function textTurns(messages: ChatMessage[]): Turn[] {
  return messages.flatMap((message) =>
    message.role === "user" || message.role === "assistant"
      ? [
          {
            role: message.role,
            content: message.parts
              .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
              .join(""),
          },
        ]
      : [],
  );
}
