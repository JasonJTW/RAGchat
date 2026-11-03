import { DocumentAdmin } from "@/components/document-admin";

export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">文件管理</h1>
      <DocumentAdmin />
    </main>
  );
}
