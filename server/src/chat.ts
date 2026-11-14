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
 */
export function streamReply(
  res: Response,
  caller: Caller,
  messages: ChatMessage[],
  files: Upload[],
  conversationId?: string,
) {
  const turns = textTurns(messages);
  const message = turns.at(-1)?.role === "user" ? turns.pop()!.content : "";
  const attachments = files.length;
  const cited = citedFacts(messages);
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const abort = new AbortController();
      // A client that leaves stops the reply too (after a full reply, a no-op).
      res.once("close", () => abort.abort());
      writer.write({ type: "start" });
      try {
        for await (const chunk of await agent.stream(
          { ...caller, turns, message, attachments, files, cited },
          { streamMode: "custom", signal: abort.signal },
        ))
          writer.write(chunk as UIMessageChunk);
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
        await saveConversation(caller, conversationId, all);
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
