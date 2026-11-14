"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Marks a term 敏感 (pseudonymised in all later input) or 不敏感 (a 排除詞,
 * never pseudonymised), e.g. a nickname detection missed or a word it took
 * for a name. Shown on a pending 提案 card, folded. Text already stored keeps
 * what it had.
 */
export function TermMarker() {
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  async function mark(sensitive: boolean) {
    const value = term.trim();
    setBusy(true);
    setDone("");
    setError("");
    try {
      const res = await fetch("/api/terms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: value, sensitive }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? res.statusText);
      }
      setTerm("");
      setDone(
        sensitive
          ? `已設為敏感：之後的輸入會以代稱取代「${value}」`
          : `已設為不敏感：之後的輸入不會取代「${value}」`,
      );
    } catch (e) {
      setError(`沒有成功：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const blank = !term.trim();
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-zinc-600">標記敏感詞</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          aria-label="用詞"
          placeholder="例如漏掉的人名或綽號"
          className="w-48"
          maxLength={100}
          value={term}
          disabled={busy}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || blank}
          onClick={() => mark(true)}
        >
          設為敏感
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || blank}
          onClick={() => mark(false)}
        >
          設為不敏感
        </Button>
      </div>
      {done && (
        <p role="status" className="mt-1 text-xs text-zinc-600">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </details>
  );
}
