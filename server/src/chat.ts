import type { Response } from "express";
// The AI SDK only speaks the UI message stream useChat reads; the agent's
// nodes write its chunks (agent/state.ts).
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessageChunk,
} from "ai";
import { agent } from "./agent/graph.js";
import type { Turn } from "./agent/state.js";
import type { Caller } from "./workspaces.js";

export type { Citation } from "./agent/ask.js";

/** The parts of an AI SDK UIMessage the chat reads. */
export interface ChatMessage {
  role: string;
  parts: { type: string; text?: string }[];
}

/**
 * Runs the agent on the latest user message and streams its reply: an answer
 * with citations, or a proposal card for input.
 */
export function streamReply(
  res: Response,
  caller: Caller,
  messages: ChatMessage[],
) {
  const turns = textTurns(messages);
  const message = turns.at(-1)?.role === "user" ? turns.pop()!.content : "";
  const latest = messages.at(-1);
  const attachments =
    latest?.role === "user"
      ? latest.parts.filter((part) => part.type === "file").length
      : 0;
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const abort = new AbortController();
      // A client that leaves stops the reply too (after a full reply, a no-op).
      res.once("close", () => abort.abort());
      writer.write({ type: "start" });
      try {
        for await (const chunk of await agent.stream(
          { ...caller, turns, message, attachments },
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
  });
  return pipeUIMessageStreamToResponse({
    response: res,
    stream,
    // Stops the Next.js rewrite proxy from gzipping the stream, which buffers
    // it until the answer is complete.
    headers: { "Cache-Control": "no-cache, no-transform" },
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
