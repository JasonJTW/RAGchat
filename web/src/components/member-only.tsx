"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect } from "react";
import useSWR from "swr";

/** Who the server says is signed in (GET /api/me). */
export interface Me {
  userId: string;
  role: "member" | "guest";
}

/** Who is signed in, inside MemberOnly; null outside it. */
export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

async function fetchMe(url: string): Promise<Me | null> {
  const res = await fetch(url);
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.json() as Promise<Me>;
}

/**
 * Shows its children to a 成員 only. The server decides who is one: a 訪客
 * is told guest trials are not open yet, and a signed-out visitor is sent to
 * sign in.
 */
export function MemberOnly({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: me, error } = useSWR("/api/me", fetchMe);
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
  if (me.role === "guest")
    return (
      <p role="status">訪客試用尚未開放。目前只有大量交織團隊成員可以使用。</p>
    );
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
