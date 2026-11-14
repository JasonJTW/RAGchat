"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import useSWR from "swr";
import { HumanCheck } from "@/components/human-check";
import { Button } from "@/components/ui/button";

/** Who the server says is signed in (GET /api/me). */
export interface Me {
  userId: string;
  role: "member" | "guest";
  /** A 訪客's only: whether they passed the human check today. */
  trial?: { verified: boolean };
}

async function fetchMe(url: string): Promise<Me | null> {
  const res = await fetch(url);
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.json() as Promise<Me>;
}

/** The signed-in user, as /api/me says (undefined while loading). */
export function useMe() {
  return useSWR("/api/me", fetchMe);
}

/**
 * The role of whoever the gate let in, for what only one role sees (a
 * 訪客's trial is not de-identified, so it has no 敏感詞). Outside a gate, a
 * 成員.
 */
export const RoleContext = createContext<Me["role"]>("member");
export const useRole = () => useContext(RoleContext);

/**
 * The user id of whoever the gate let in, for what only one user sees (the
 * uploader's 刪除來源). Outside a gate, nobody.
 */
export const UserIdContext = createContext<string | null>(null);
export const useUserId = () => useContext(UserIdContext);

/**
 * Shows its children to whoever has a workspace: a 成員 (the team's), or a
 * 訪客 who passed the human check (their 試用工作區, under a banner saying
 * so). A 訪客 who has not is shown the check; a signed-out visitor is sent
 * to sign in.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: me, error, mutate } = useMe();
  const signedOut = me === null;
  useEffect(() => {
    if (signedOut) router.replace("/sign-in");
  }, [signedOut, router]);

  if (error)
    return (
      <p role="alert" className="text-red-600">
        無法確認登入狀態，請重新整理
      </p>
    );
  if (!me) return null;
  if (me.role === "member")
    return (
      <UserIdContext.Provider value={me.userId}>
        {children}
      </UserIdContext.Provider>
    );
  if (!me.trial?.verified)
    return (
      <section className="flex flex-col gap-3">
        <p>
          歡迎試用！你會得到自己的試用工作區，裡面是一個虛構團隊「好物輪轉」的示範資料，
          可以提問、上傳、修正與確認，不會碰到真實的團隊資料。
        </p>
        <HumanCheck onPassed={() => void mutate()} />
      </section>
    );
  return (
    <RoleContext.Provider value="guest">
      <UserIdContext.Provider value={me.userId}>
        <TrialBanner />
        {children}
      </UserIdContext.Provider>
    </RoleContext.Provider>
  );
}

function TrialBanner() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (
      !window.confirm(
        "要把試用工作區重設回示範資料嗎？你的上傳、修正與對話都會刪除。",
      )
    )
      return;
    setBusy(true);
    const res = await fetch("/api/trial/reset", { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError("重設失敗，請稍後再試。");
    window.location.replace("/");
  }

  return (
    <section
      aria-label="試用工作區"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
    >
      <p className="flex-1">
        這是你的試用工作區：內容是虛構團隊「好物輪轉」的示範資料，只有你看得到。
        閒置 7 天後會刪除。
      </p>
      <Button type="button" variant="outline" disabled={busy} onClick={reset}>
        重設試用工作區
      </Button>
      {error && (
        <p role="alert" className="w-full text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
