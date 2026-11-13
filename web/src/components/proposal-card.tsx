"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Proposal } from "@/lib/chat-message";
import { teamDate } from "@/lib/team-date";

const KIND = { add: "新增", supersede: "取代", obsolete: "過時" } as const;

const DECIDED = {
  confirmed: "已確認，已寫入知識庫。",
  rejected: "已拒絕，沒有寫入知識庫。",
} as const;

// A card with more items than this folds its 新增 items away, so the 取代
// and 過時 items, which change existing knowledge, are what the member reads.
const FOLD_ADDS_OVER = 10;

type Item = Proposal["items"][number];

/**
 * A 提案 waiting for a member: its items grouped, 取代 and 過時 first and
 * open, 新增 after them (folded when there are many). A 新增 item shows its
 * fact; a 取代 item the old and the new fact side by side; a 過時 item the
 * fact it ends; each change with its reason and the date it takes effect.
 * Each item can be unticked, each new fact edited inline; 確認 sends the
 * ticked items with their edited texts over REST, 拒絕 rejects them all.
 * Nothing changes in the knowledge base until 確認.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [decided, setDecided] = useState<Proposal>(proposal);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = decided.status === "pending";

  const edits = proposal.items.flatMap((item) => {
    const text = texts[item.id];
    return item.factId &&
      !unticked.has(item.id) &&
      text !== undefined &&
      text.trim() !== item.content
      ? [{ itemId: item.id, content: text }]
      : [];
  });
  const blank = proposal.items.some(
    (item) =>
      !unticked.has(item.id) &&
      texts[item.id] !== undefined &&
      !texts[item.id].trim(),
  );
  const ticked = proposal.items.length - unticked.size;

  async function decide(action: "confirm" | "reject") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/${action}`, {
        method: "POST",
        ...(action === "confirm" && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits, excluded: [...unticked] }),
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

  const items = pending ? proposal.items : decided.items;
  const changes = items.filter((item) => item.kind !== "add");
  const adds = items.filter((item) => item.kind === "add");
  const renderItem = (item: Item) => (
    <ItemRow
      key={item.id}
      item={item}
      pending={pending}
      text={texts[item.id]}
      ticked={!unticked.has(item.id)}
      disabled={busy}
      onTick={(on) => {
        const next = new Set(unticked);
        if (on) next.delete(item.id);
        else next.add(item.id);
        setUnticked(next);
      }}
      onChange={(text) => setTexts({ ...texts, [item.id]: text })}
    />
  );

  return (
    <section
      aria-label="提案"
      className="mt-2 rounded-md border bg-zinc-50 p-3"
    >
      <h2 className="text-sm font-medium text-zinc-600">
        提案 ·{" "}
        {(["supersede", "obsolete", "add"] as const)
          .flatMap((kind) => {
            const n = items.filter((item) => item.kind === kind).length;
            return n ? [`${KIND[kind]} ${n} 項`] : [];
          })
          .join("、")}
      </h2>
      {changes.length > 0 && (
        <Group title="取代與過時" open>
          {changes.map(renderItem)}
        </Group>
      )}
      {adds.length > 0 &&
        (changes.length === 0 && items.length <= FOLD_ADDS_OVER ? (
          <ul className="mt-2 space-y-2">{adds.map(renderItem)}</ul>
        ) : (
          <Group
            title={`新增（${adds.length} 項）`}
            open={items.length <= FOLD_ADDS_OVER}
          >
            {adds.map(renderItem)}
          </Group>
        ))}
      {decided.status === "pending" ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            disabled={busy || blank || ticked === 0}
            onClick={() => decide("confirm")}
          >
            {unticked.size ? `確認所選（${ticked} 項）` : "確認"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => decide("reject")}
          >
            拒絕
          </Button>
          {unticked.size > 0 && (
            <span className="text-xs text-zinc-500">
              未勾選的 {unticked.size} 項不會改動知識庫
            </span>
          )}
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

function Group({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="mt-2">
      <summary className="cursor-pointer text-sm text-zinc-600">
        {title}
      </summary>
      <ul className="mt-1 space-y-2">{children}</ul>
    </details>
  );
}

/**
 * One item: while pending, a tick to include it; then its target (舊 or
 * 過時), its new fact (editable while pending) and the change's reason and
 * date. Once decided, an item that took no effect is marked 未納入.
 */
function ItemRow({
  item,
  pending,
  text,
  ticked,
  disabled,
  onTick,
  onChange,
}: {
  item: Item;
  pending: boolean;
  text: string | undefined;
  ticked: boolean;
  disabled: boolean;
  onTick: (ticked: boolean) => void;
  onChange: (text: string) => void;
}) {
  const left = !pending && item.status === "rejected";
  return (
    <li className="flex items-start gap-2">
      {pending && (
        <input
          type="checkbox"
          aria-label="納入"
          className="mt-1.5"
          checked={ticked}
          disabled={disabled}
          onChange={(e) => onTick(e.currentTarget.checked)}
        />
      )}
      <div
        className={
          (pending && !ticked) || left ? "flex-1 text-zinc-400" : "flex-1"
        }
      >
        {item.target && (
          <Labelled label={item.kind === "obsolete" ? "過時" : "舊"}>
            <del>{item.target.content}</del>
          </Labelled>
        )}
        {item.factId &&
          (pending ? (
            <EditableFact
              item={item}
              text={text}
              disabled={disabled || !ticked}
              onChange={onChange}
            />
          ) : (
            <Labelled label={item.target ? "新" : undefined}>
              {item.content}
              {item.edited && (
                <span className="ml-2 text-xs text-zinc-500">
                  經 {item.edited.by} 編輯
                </span>
              )}
            </Labelled>
          ))}
        {item.target && (
          <p className="text-xs text-zinc-500">
            {item.reason && <>原因：{item.reason} · </>}
            {item.effectiveAt && <>生效日期：{teamDate(item.effectiveAt)}</>}
          </p>
        )}
        {left && <span className="text-xs">未納入</span>}
      </div>
    </li>
  );
}

/**
 * One line of an item, e.g. 舊 or 新 on a 取代 item; `label` names it for
 * the eye and for assistive tech. Without a label, just the content.
 */
function Labelled({
  label,
  children,
}: {
  label: string | undefined;
  children: React.ReactNode;
}) {
  if (!label) return <div>{children}</div>;
  return (
    <div className="flex gap-2">
      <span aria-hidden className="shrink-0 text-xs text-zinc-500">
        {label}
      </span>
      <span aria-label={label}>{children}</span>
    </div>
  );
}

/**
 * The new fact of a pending item: its text, or once 編輯 is pressed a box to
 * change it. `text` is undefined until the member starts editing.
 */
function EditableFact({
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
  const label = item.target ? "新" : undefined;
  if (text === undefined)
    return (
      <div className="flex items-center gap-2">
        <Labelled label={label}>{item.content}</Labelled>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(item.content ?? "")}
        >
          編輯
        </Button>
      </div>
    );
  return (
    <div>
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
    </div>
  );
}
