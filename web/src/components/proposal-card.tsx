"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Proposal } from "@/lib/chat-message";

const DECIDED = {
  confirmed: "已確認，已寫入知識庫。",
  rejected: "已拒絕，沒有寫入知識庫。",
} as const;

type Item = Proposal["items"][number];

/**
 * A 提案 waiting for a member: its facts, each editable inline, and buttons
 * that confirm (with the edited texts) or reject it over REST. Nothing
 * enters the knowledge base until 確認.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [decided, setDecided] = useState<Proposal>(proposal);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = decided.status === "pending";

  const edits = proposal.items.flatMap((item) => {
    const text = texts[item.id];
    return text !== undefined && text.trim() !== item.content
      ? [{ itemId: item.id, content: text }]
      : [];
  });
  const blank = Object.values(texts).some((text) => !text.trim());

  async function decide(action: "confirm" | "reject") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/${action}`, {
        method: "POST",
        ...(action === "confirm" && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits }),
        }),
      });
      const body = (await res.json()) as Proposal | { error: string };
      if (!res.ok)
        throw new Error("error" in body ? body.error : res.statusText);
      setDecided(body as Proposal);
    } catch (e) {
      setError(`沒有成功：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="提案"
      className="mt-2 rounded-md border bg-zinc-50 p-3"
    >
      <h2 className="text-sm font-medium text-zinc-600">提案 · 新增</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {(pending ? proposal.items : decided.items).map((item) =>
          pending ? (
            <EditableItem
              key={item.id}
              item={item}
              text={texts[item.id]}
              disabled={busy}
              onChange={(text) => setTexts({ ...texts, [item.id]: text })}
            />
          ) : (
            <li key={item.id}>
              {item.content}
              {item.edited && (
                <span className="ml-2 text-xs text-zinc-500">
                  經 {item.edited.by} 編輯
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {decided.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            disabled={busy || blank}
            onClick={() => decide("confirm")}
          >
            確認
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => decide("reject")}
          >
            拒絕
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">{DECIDED[decided.status]}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * One pending item: its text, or once 編輯 is pressed a box to change it.
 * `text` is undefined until the member starts editing.
 */
function EditableItem({
  item,
  text,
  disabled,
  onChange,
}: {
  item: Item;
  text: string | undefined;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  if (text === undefined)
    return (
      <li>
        {item.content}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-2"
          disabled={disabled}
          onClick={() => onChange(item.content)}
        >
          編輯
        </Button>
      </li>
    );
  return (
    <li>
      <Textarea
        aria-label="事實內容"
        value={text}
        maxLength={2000}
        disabled={disabled}
        aria-invalid={!text.trim()}
        onChange={(e) => onChange(e.target.value)}
      />
      {text.trim() !== item.content && (
        <span className="text-xs text-zinc-500">
          {text.trim() ? "已編輯" : "內容不可空白"}
        </span>
      )}
    </li>
  );
}
