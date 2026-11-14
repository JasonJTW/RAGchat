import type { ChatMessage, Proposal } from "./chat-message";

/**
 * The saved messages with every proposal they show (a card, or a 待確認
 * citation's) as it stands now (GET /api/proposals/{id}): a card saved
 * pending may have been confirmed, rejected or expired since. A card whose
 * proposal is gone (its source hard-deleted) is dropped, and so is a
 * citation's; one that can't be read now stays as saved.
 */
export async function withCurrentProposals(
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const ids = new Set(
    messages.flatMap((m) =>
      m.parts.flatMap((part) =>
        part.type === "data-proposal"
          ? [part.data.id]
          : part.type === "data-citation" && part.data.proposal
            ? [part.data.proposal.id]
            : [],
      ),
    ),
  );
  const now = new Map(
    await Promise.all(
      [...ids].map(async (id) => [id, await current(id)] as const),
    ),
  );
  return messages.map((m) => ({
    ...m,
    parts: m.parts.flatMap((part): ChatMessage["parts"] => {
      if (part.type === "data-proposal") {
        const found = now.get(part.data.id);
        if (found === "gone") return [];
        return [found ? { ...part, data: found } : part];
      }
      if (part.type === "data-citation" && part.data.proposal) {
        const found = now.get(part.data.proposal.id);
        if (!found) return [part];
        const data = { ...part.data };
        if (found === "gone") delete data.proposal;
        else data.proposal = found;
        return [{ ...part, data }];
      }
      return [part];
    }),
  }));
}

// The proposal now; "gone" when it no longer exists; undefined when it
// can't be read.
async function current(id: string): Promise<Proposal | "gone" | undefined> {
  try {
    const res = await fetch(`/api/proposals/${encodeURIComponent(id)}`);
    if (res.status === 404) return "gone";
    if (!res.ok) return undefined;
    return (await res.json()) as Proposal;
  } catch {
    return undefined;
  }
}
