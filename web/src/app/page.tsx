import { Chat } from "@/components/chat";
import { MemberOnly } from "@/components/member-only";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">大量交織團隊 wiki</h1>
      <MemberOnly>
        <Chat />
      </MemberOnly>
    </main>
  );
}
