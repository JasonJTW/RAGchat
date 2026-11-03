import type { Response } from "express";
import { createUIMessageStream, pipeUIMessageStreamToResponse } from "ai";
import type { Citation } from "./citation.js";

// Walking skeleton: a fixed answer and citation stand in for retrieval + LLM.
const STUB_ANSWER = "這是骨架的假回答，之後會換成依文件產生的回答。";
const STUB_CITATION: Citation = {
  id: "stub-1",
  label: "骨架假出處 › 第 1 段",
  text: "這是骨架的假出處原文。",
};

export function streamAnswer(res: Response): Promise<void> {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "answer" });
      for (const char of STUB_ANSWER) {
        writer.write({ type: "text-delta", id: "answer", delta: char });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      writer.write({ type: "text-end", id: "answer" });
      writer.write({
        type: "data-citation",
        id: STUB_CITATION.id,
        data: STUB_CITATION,
      });
      writer.write({ type: "finish" });
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
