"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMessage } from "@/lib/chat-message";

export function Chat() {
  const { messages, sendMessage, status } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-1 flex-col gap-3">
        {messages.map((message) =>
          message.role === "user" ? (
            <p
              key={message.id}
              className="self-end rounded-lg bg-zinc-900 px-3 py-2 text-white"
            >
              {message.parts.map((part) =>
                part.type === "text" ? part.text : null,
              )}
            </p>
          ) : (
            <article
              key={message.id}
              aria-label="回答"
              className="rounded-lg border px-3 py-2"
            >
              {message.parts.map((part, i) =>
                part.type === "text" ? (
                  <p key={i} className="whitespace-pre-wrap">
                    {part.text}
                  </p>
                ) : null,
              )}
              <Citations message={message} />
            </article>
          ),
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <Textarea
          aria-label="問題"
          placeholder="問問大量交織的事…"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
        />
        <Button type="submit" disabled={busy}>
          送出
        </Button>
      </form>
    </div>
  );
}

function Citations({ message }: { message: ChatMessage }) {
  const citations = message.parts.flatMap((part) =>
    part.type === "data-citation" ? [part.data] : [],
  );
  if (citations.length === 0) return null;
  return (
    <ul aria-label="出處" className="mt-2 border-t pt-2 text-sm text-zinc-600">
      {citations.map((citation) => (
        <li key={citation.id}>
          <details>
            <summary className="cursor-pointer">
              [{citation.marker}] {citation.label}
            </summary>
            <p className="mt-1 whitespace-pre-wrap">{citation.text}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}
