import { Suspense } from "react";
import { DraftProvider } from "@/components/chat-draft";
import { Conversations } from "@/components/conversations";
import { TrialGuide } from "@/components/trial-guide";
import { WorkspaceGate } from "@/components/workspace-gate";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">大量交織團隊 wiki</h1>
      <WorkspaceGate>
        <DraftProvider>
          <TrialGuide />
          {/* Conversations reads the URL, which Next.js only allows inside Suspense. */}
          <Suspense>
            <Conversations />
          </Suspense>
        </DraftProvider>
      </WorkspaceGate>
    </main>
  );
}
