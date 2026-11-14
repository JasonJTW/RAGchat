"use client";

import { useEffect, useState } from "react";
import { ProposalCard } from "@/components/proposal-card";
import type { Proposal } from "@/lib/chat-message";

/**
 * The workspace's pending 提案, oldest first, each as a card any 成員 can
 * confirm or reject. Read once when shown; a decided card stays in place
 * with its outcome.
 */
export function PendingProposals() {
  const [proposals, setProposals] = useState<Proposal[] | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/proposals")
      .then(async (res) => {
        if (!res.ok) throw new Error(res.statusText);
        setProposals((await res.json()) as Proposal[]);
      })
      .catch((e: Error) => setError(`讀取失敗：${e.message}`));
  }, []);

  if (error)
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  if (!proposals) return <p className="text-sm text-zinc-500">讀取中…</p>;
  if (!proposals.length)
    return <p className="text-sm text-zinc-500">目前沒有待確認的提案。</p>;
  return (
    <div className="flex flex-col gap-4">
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  );
}
