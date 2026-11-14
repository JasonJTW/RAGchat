"use client";

import { useState } from "react";
import { useDraft } from "@/components/chat-draft";
import { Button } from "@/components/ui/button";
import { useMe } from "@/components/workspace-gate";

// What a 訪客 can try first (server/demo-data/README.md): three questions
// the 示範資料 answers, and a meeting summary whose upload replaces the
// current formula. Shown to a 訪客 only.

export const EXAMPLE_QUESTIONS = [
  "避免排放算法現在怎麼算？",
  "為什麼決定在公式裡加入壽命比？",
  "三月時我們的避免排放公式是什麼？",
];
const EXAMPLE_FILE = "meeting-2026-11-12.txt";
const EXAMPLE_NOTE = "請把這份會議紀錄輸入到知識庫";

export function TrialGuide() {
  const { data: me } = useMe();
  const { setDraft } = useDraft();
  const [error, setError] = useState("");
  if (me?.role !== "guest") return null;

  async function attachExample() {
    const res = await fetch("/api/trial/example");
    if (!res.ok) return setError("無法取得範例檔，請稍後再試。");
    const file = new File([await res.blob()], EXAMPLE_FILE, {
      type: "text/plain",
    });
    setError("");
    setDraft({ text: EXAMPLE_NOTE, files: [file] });
  }

  return (
    <section aria-label="試試看" className="flex flex-col gap-2 text-sm">
      <h2 className="font-medium">試試看這樣問</h2>
      <ul className="flex flex-wrap gap-2">
        {EXAMPLE_QUESTIONS.map((question) => (
          <li key={question}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft({ text: question, files: [] })}
            >
              {question}
            </Button>
          </li>
        ))}
      </ul>
      <p>
        再上傳一份新的會議紀錄（
        <a className="underline" href="/api/trial/example" download>
          {EXAMPLE_FILE}
        </a>
        ），確認提案後再問一次第一題，就會看到公式被取代。
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => void attachExample()}
      >
        附加範例檔
      </Button>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
