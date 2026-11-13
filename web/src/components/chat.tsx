"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProposalCard } from "@/components/proposal-card";
import type { ChatMessage } from "@/lib/chat-message";

// What the server reads as a 來源 (server/src/source-files.ts); it says so
// itself when a file is of another format.
const ACCEPT = ".md,.txt,.pdf,.docx";
const MAX_FILES = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// An attached file was read when its message was sent; later requests carry
// the conversation without the files' data.
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
              parts: message.parts.filter((part) => part.type !== "file"),
            },
      ),
    },
  }),
});

export function Chat() {
  const { messages, sendMessage, setMessages, status, stop } =
    useChat<ChatMessage>({ transport });
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const busy = status === "submitted" || status === "streaming";

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
      <Button
        type="button"
        variant="outline"
        className="self-end"
        onClick={() => {
          void stop();
          setMessages([]);
          setInput("");
          setFiles([]);
        }}
      >
        新對話
      </Button>
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
                <figcaption className="text-xs">
                  來源原文
                  {citation.source.label && ` · ${citation.source.label}`}
                </figcaption>
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
