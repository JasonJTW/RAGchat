import { Suspense } from "react";
import { Conversations } from "@/components/conversations";
import { MemberOnly } from "@/components/member-only";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">大量交織團隊 wiki</h1>
      <MemberOnly>
        {/* Conversations reads the URL, which Next.js only allows inside Suspense. */}
        <Suspense>
          <Conversations />
        </Suspense>
      </MemberOnly>
    </main>
  );
}
