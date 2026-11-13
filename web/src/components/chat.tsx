"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProposalCard } from "@/components/proposal-card";
import type { ChatMessage } from "@/lib/chat-message";

/**
 * One conversation: its messages and the box to ask or input. The server
 * saves it under `id` with every reply; `onSaved` runs once a reply is in.
 */
export function Chat({
  id,
  initialMessages,
  onSaved,
}: {
  id: string;
  initialMessages: ChatMessage[];
  onSaved: () => void;
}) {
  const { messages, sendMessage, status } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onFinish: onSaved,
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
                ) : part.type === "data-proposal" ? (
                  <ProposalCard key={i} proposal={part.data} />
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
          placeholder="提問，或寫「請把以下內容輸入到知識庫：…」"
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
            {citation.edited && (
              <figure className="mt-1">
                <figcaption className="text-xs">
                  經 {citation.edited.by} 編輯，原始抽取：
                </figcaption>
                <blockquote className="border-l-2 pl-2 whitespace-pre-wrap">
                  {citation.edited.originalContent}
                </blockquote>
              </figure>
            )}
            {citation.source && (
              <figure className="mt-1">
                <figcaption className="text-xs">來源原文</figcaption>
                <blockquote className="border-l-2 pl-2 whitespace-pre-wrap">
                  {citation.source.content}
                </blockquote>
              </figure>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}
