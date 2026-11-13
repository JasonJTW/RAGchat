import { SignInForm } from "@/components/auth";

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">登入大量交織團隊 wiki</h1>
      <SignInForm />
    </main>
  );
}
