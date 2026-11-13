"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Proposal } from "@/lib/chat-message";

const DECIDED = {
  confirmed: "已確認，已寫入知識庫。",
  rejected: "已拒絕，沒有寫入知識庫。",
} as const;

/**
 * A 提案 waiting for a member: its facts, and buttons that confirm or reject
 * it over REST. Nothing enters the knowledge base until 確認.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [status, setStatus] = useState(proposal.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(action: "confirm" | "reject") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/${action}`, {
        method: "POST",
      });
      const body = (await res.json()) as Proposal | { error: string };
      if (!res.ok)
        throw new Error("error" in body ? body.error : res.statusText);
      setStatus((body as Proposal).status);
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
        {proposal.items.map((item) => (
          <li key={item.id}>{item.content}</li>
        ))}
      </ul>
      {status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            disabled={busy}
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
        <p className="mt-3 text-sm text-zinc-600">{DECIDED[status]}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
