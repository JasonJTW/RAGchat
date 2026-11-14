"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { useRef, useState } from "react";
import { useDraft } from "@/components/chat-draft";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProposalCard } from "@/components/proposal-card";
import type { ChatMessage, HistoryEntry } from "@/lib/chat-message";
import { teamDate } from "@/lib/team-date";

// What the server reads as a 來源 (server/src/source-files.ts); it says so
// itself when a file is of another format.
const ACCEPT = ".md,.txt,.pdf,.docx";
const MAX_FILES = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// An attached file was read when its message was sent; later requests carry
// it by name only, without its data.
const transport = new DefaultChatTransport<ChatMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages, body, id, trigger, messageId }) => ({
    body: {
      ...body,
      id,
      trigger,
      messageId,
      messages: messages.map((message, i) =>
        i === messages.length - 1
          ? message
          : {
              ...message,
              parts: message.parts.map((part) =>
                part.type === "file" ? { ...part, url: "" } : part,
              ),
            },
      ),
    },
  }),
});

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
  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    transport,
    onFinish: onSaved,
  });
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const busy = status === "submitted" || status === "streaming";
  // A draft put in from outside (e.g. an example question) fills the box,
  // once per draft.
  const { draft } = useDraft();
  const [taken, setTaken] = useState(draft);
  if (draft !== taken) {
    setTaken(draft);
    if (draft) {
      setInput(draft.text);
      setFiles(draft.files);
    }
  }

  function attach(chosen: File[]) {
    const all = [...files, ...chosen];
    if (all.length > MAX_FILES)
      return setFileError(`一次最多附加 ${MAX_FILES} 個檔案`);
    if (all.some((file) => file.size > MAX_FILE_BYTES))
      return setFileError("每個檔案最大 5 MB");
    setFileError("");
    setFiles(all);
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-1 flex-col gap-3">
        {messages.map((message) =>
          message.role === "user" ? (
            <p
              key={message.id}
              className="self-end rounded-lg bg-zinc-900 px-3 py-2 whitespace-pre-wrap text-white"
            >
              {message.parts.map((part, i) =>
                part.type === "text" ? (
                  part.text
                ) : part.type === "file" ? (
                  <span
                    key={i}
                    className="mr-2 inline-block rounded bg-zinc-700 px-2 text-sm"
                  >
                    📎 {part.filename}
                  </span>
                ) : null,
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
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {refusalOf(error)}
        </p>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!input.trim() && files.length === 0) return;
          const parts = await Promise.all(files.map(filePart));
          sendMessage({ text: input, files: parts });
          setInput("");
          setFiles([]);
        }}
      >
        {files.length > 0 && (
          <ul aria-label="附件" className="flex flex-wrap gap-2 text-sm">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-center gap-1 rounded border px-2"
              >
                📎 {file.name}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
        {fileError && (
          <p role="alert" className="text-sm text-red-600">
            {fileError}
          </p>
        )}
        <div className="flex gap-2">
          <Textarea
            aria-label="問題"
            placeholder="提問、附加檔案，或寫「請把以下內容輸入到知識庫：…」"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
          />
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            aria-label="選擇附件"
            className="hidden"
            onChange={(e) => {
              attach([...(e.currentTarget.files ?? [])]);
              e.currentTarget.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            附加檔案
          </Button>
          <Button type="submit" disabled={busy}>
            送出
          </Button>
        </div>
      </form>
    </div>
  );
}

function Citations({ message }: { message: ChatMessage }) {
  const citations = message.parts.flatMap((part) =>
    part.type === "data-citation" ? [part.data] : [],
  );
  if (citations.length === 0) return null;
  // A 提案's card goes under the first of its facts cited.
  const carded = new Set<string>();
  return (
    <ul aria-label="出處" className="mt-2 border-t pt-2 text-sm text-zinc-600">
      {citations.map((citation) => {
        const proposal = citation.proposal;
        const card = proposal && !carded.has(proposal.id);
        if (proposal) carded.add(proposal.id);
        return (
          <li key={citation.id}>
            <details>
              <summary className="cursor-pointer">
                [{citation.marker}] {citation.label}
                {proposal && (
                  <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900">
                    未經團隊確認
                  </span>
                )}
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
              {citation.history && <History entries={citation.history} />}
              {citation.source && (
                <figure className="mt-1">
                  <figcaption className="text-xs">
                    來源原文
                    {citation.source.label && ` · ${citation.source.label}`}
                  </figcaption>
                  <blockquote className="border-l-2 pl-2 whitespace-pre-wrap">
                    {citation.source.content}
                  </blockquote>
                </figure>
              )}
              {card && <ProposalCard proposal={proposal} />}
            </details>
          </li>
        );
      })}
    </ul>
  );
}

// What the server said when it refused the message (e.g. a 訪客 over the
// day's limit): its JSON `error`, else a generic line.
function refusalOf(error: Error): string {
  try {
    const body = JSON.parse(error.message) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not the server's JSON.
  }
  return "送出失敗，請稍後再試。";
}

/** The file as a `file` part: a data URL with its name. */
function filePart(file: File): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        type: "file",
        mediaType: file.type || "application/octet-stream",
        filename: file.name,
        url: reader.result as string,
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** A fact's history chain, oldest first: each version, when it held, and why. */
function History({ entries }: { entries: HistoryEntry[] }) {
  return (
    <figure className="mt-1">
      <figcaption className="text-xs">歷史</figcaption>
      <ol aria-label="歷史" className="list-decimal pl-5">
        {entries.map((entry) => (
          <li key={entry.factId}>
            <span className={entry.validTo ? "text-zinc-400" : undefined}>
              {entry.content}
            </span>
            <span className="ml-2 text-xs">
              {teamDate(entry.validFrom)} 起
              {entry.validTo ? `，${teamDate(entry.validTo)} 止` : "，現行"}
              {entry.reason && `；原因：${entry.reason}`}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
