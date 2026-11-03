"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/lib/use-hydrated";

export function LoginForm() {
  const router = useRouter();
  // Before hydration a submit would be a native GET with the password in the URL.
  const hydrated = useHydrated();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      if (res.status === 401) {
        setError("帳號或密碼錯誤");
        return;
      }
      if (!res.ok) throw new Error(`login failed: ${res.status}`);
      router.replace("/admin");
    } catch {
      setError("登入失敗，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={logIn} className="flex max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        帳號
        <Input name="username" autoComplete="username" required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        密碼
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="self-start"
        disabled={!hydrated || submitting}
      >
        登入
      </Button>
    </form>
  );
}
