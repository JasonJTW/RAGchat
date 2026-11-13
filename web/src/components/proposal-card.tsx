"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Conflict, Proposal } from "@/lib/chat-message";
import { teamDate } from "@/lib/team-date";

const KIND = { add: "新增", supersede: "取代", obsolete: "過時" } as const;

const DECIDED = {
  confirmed: "已確認，已寫入知識庫。",
  rejected: "已拒絕，沒有寫入知識庫。",
  expired: "已過期：較新的提案已確認同樣的內容。",
} as const;

type Item = Proposal["items"][number];

/**
 * A 提案 waiting for a member: its items, and buttons that confirm (with the
 * edited texts) or reject it over REST. A 新增 item shows its fact; a 取代
 * item the old and the new fact side by side; a 過時 item the fact it ends;
 * each change with its reason and the date it takes effect. Each new fact is
 * editable inline. Nothing changes in the knowledge base until 確認.
 *
 * Before 確認 the card lists the older pending items confirming will expire.
 * When the knowledge base changed since the proposal was made, 確認 is
 * stopped and the card shows each change (舊 → 新): the member rejects, or
 * confirms anyway (仍確認) having seen them.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [decided, setDecided] = useState<Proposal>(proposal);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const pending = decided.status === "pending";
  // What it would expire was read when the card was made; once confirming
  // shows the knowledge base changed since, that list may be out of date.
  const expires = pending && !conflicts.length ? (decided.expires ?? []) : [];

  const edits = proposal.items.flatMap((item) => {
    const text = texts[item.id];
    return item.factId && text !== undefined && text.trim() !== item.content
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
          body: JSON.stringify({
            edits,
            acknowledged: conflicts.map((c) => c.changeId),
          }),
        }),
      });
      const body = (await res.json()) as
        Proposal | { error: string; conflicts?: Conflict[] };
      if (!res.ok && "conflicts" in body && body.conflicts?.length) {
        setConflicts(body.conflicts);
        return;
      }
      if (!res.ok)
        throw new Error("error" in body ? body.error : res.statusText);
      setConflicts([]);
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
      <h2 className="text-sm font-medium text-zinc-600">
        提案 ·{" "}
        {[...new Set(proposal.items.map((item) => KIND[item.kind]))].join("、")}
        <span className="ml-2 text-xs text-zinc-500">
          {decided.createdBy} 提出
        </span>
      </h2>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        {(pending ? proposal.items : decided.items).map((item) => (
          <li key={item.id}>
            {item.target && (
              <Labelled label={item.kind === "obsolete" ? "過時" : "舊"}>
                <del>{item.target.content}</del>
              </Labelled>
            )}
            {item.expiredBy ? (
              <Labelled label="已過期">
                <span className="text-zinc-400">
                  {item.content ?? item.target?.content}
                </span>
              </Labelled>
            ) : (
              item.factId &&
              (pending ? (
                <EditableFact
                  item={item}
                  text={texts[item.id]}
                  disabled={busy}
                  onChange={(text) => setTexts({ ...texts, [item.id]: text })}
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
              ))
            )}
            {item.target && !item.expiredBy && (
              <p className="text-xs text-zinc-500">
                {item.reason && <>原因：{item.reason} · </>}
                {item.effectiveAt && (
                  <>生效日期：{teamDate(item.effectiveAt)}</>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
      {expires.length > 0 && (
        <div className="mt-3 text-sm text-zinc-600">
          <p>確認後，以下較早的待確認項目會過期：</p>
          <ul aria-label="會過期的項目" className="list-disc pl-5">
            {expires.map((item) => (
              <li key={item.itemId}>
                {item.content}
                <span className="ml-2 text-xs text-zinc-500">
                  {item.createdBy} 提出
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pending && conflicts.length > 0 && (
        <div
          role="alert"
          aria-label="知識庫已變更"
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm"
        >
          <p>這則提案建立後，知識庫有相關變更，請判斷是否仍要確認：</p>
          <ul className="mt-1 space-y-1">
            {conflicts.map((c) => (
              <li key={c.changeId}>
                {c.before && (
                  <Labelled label="變更前">
                    <del>{c.before}</del>
                  </Labelled>
                )}
                {c.after && <Labelled label="變更後">{c.after}</Labelled>}
                {!c.after && <Labelled label="變更後">過時</Labelled>}
                <span className="text-xs text-zinc-500">
                  {c.decidedBy} 確認 · {teamDate(c.decidedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {decided.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            disabled={busy || blank}
            onClick={() => decide("confirm")}
          >
            {conflicts.length ? "仍確認" : "確認"}
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
