import { DocumentList } from "@/components/document-list";
import { MemberOnly } from "@/components/member-only";

// Uploaded documents whose passages answers still cite, until uploads go
// into the knowledge base through the chat (#30).
export default function DocumentsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">文件</h1>
      <MemberOnly>
        <DocumentList />
      </MemberOnly>
    </main>
  );
}
