import { MemberOnly } from "@/components/member-only";
import { PendingProposals } from "@/components/pending-proposals";

// Every pending 提案 of the team, whoever made it, for any 成員 to decide.
export default function ProposalsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">待確認提案</h1>
      <MemberOnly>
        <PendingProposals />
      </MemberOnly>
    </main>
  );
}
