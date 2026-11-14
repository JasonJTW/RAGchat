"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Chat } from "@/components/chat";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/lib/chat-message";
import { withCurrentProposals } from "@/lib/current-proposals";

/** A saved conversation as listed (server/openapi.yaml's ConversationSummary). */
interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

const LIST = "/api/conversations";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * The 成員's saved conversations beside the open one. `/?c=<id>` opens a
 * saved conversation; `/` starts a new one, which joins the list (and the
 * URL) once its first reply is saved.
 *
 * It switches conversations with the History API, which Next.js syncs with
 * useSearchParams without refetching the page from the server.
 */
export function Conversations() {
  const opened = useSearchParams().get("c");
  // The new conversation's id. It stays while the new conversation is open
  // (also once the URL names it); opening any other conversation retires it,
  // so the next `/` never takes over a saved one, and coming back to it
  // reloads it from the server.
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const [shown, setShown] = useState(opened);
  if (opened !== shown) {
    setShown(opened);
    if (opened !== fresh) setFresh(crypto.randomUUID());
  }
  const current = useRef(fresh);
  useEffect(() => {
    current.current = fresh;
  }, [fresh]);
  const id = opened ?? fresh;
  const { data: list, mutate } = useSWR(LIST, fetchJson<ConversationSummary[]>);

  return (
    <div className="flex flex-1 flex-col gap-6 md:flex-row">
      <nav aria-label="對話紀錄" className="flex flex-col gap-2 md:w-56">
        <Button
          type="button"
          variant="outline"
          onClick={() => window.history.pushState(null, "", "/")}
        >
          新對話
        </Button>
        {list?.length === 0 && (
          <p className="text-sm text-zinc-500">還沒有對話</p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {list?.map((conversation) => (
            <li key={conversation.id}>
              <a
                href={hrefOf(conversation.id)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  window.history.pushState(null, "", hrefOf(conversation.id));
                }}
                aria-current={conversation.id === id ? "page" : undefined}
                className="block truncate rounded px-2 py-1 hover:bg-zinc-100 aria-[current=page]:bg-zinc-100 aria-[current=page]:font-medium"
              >
                {conversation.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {id === fresh ? (
        <Chat
          key={id}
          id={id}
          initialMessages={[]}
          onSaved={() => {
            // Still the open new conversation: let the URL name it.
            if (current.current === id)
              window.history.replaceState(null, "", hrefOf(id));
            void mutate();
          }}
        />
      ) : (
        <SavedChat key={id} id={id} onSaved={() => void mutate()} />
      )}
    </div>
  );
}

const hrefOf = (id: string) => `/?c=${encodeURIComponent(id)}`;

/** A saved conversation, loaded from the server and continued in place. */
function SavedChat({ id, onSaved }: { id: string; onSaved: () => void }) {
  // Its proposal cards as they stand now, not as they were saved.
  const { data, error } = useSWR(
    `${LIST}/${encodeURIComponent(id)}`,
    async (url: string) => {
      const saved = await fetchJson<{ messages: ChatMessage[] }>(url);
      return { messages: await withCurrentProposals(saved.messages) };
    },
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
  if (error)
    return (
      <p role="alert" className="text-red-600">
        找不到這段對話
      </p>
    );
  if (!data) return null;
  return <Chat id={id} initialMessages={data.messages} onSaved={onSaved} />;
}
