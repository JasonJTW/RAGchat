"use client";

import useSWR from "swr";

async function namesOf(url: string): Promise<Record<string, string>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.json() as Promise<Record<string, string>>;
}

/**
 * The name to show for a user id (GET /api/people): who proposed, confirmed
 * or edited, never their raw id. While it loads, or when it can't be read,
 * 「成員」.
 */
export function Person({ id }: { id: string }) {
  const { data } = useSWR(
    `/api/people?ids=${encodeURIComponent(id)}`,
    namesOf,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  return <>{data?.[id] ?? "成員"}</>;
}
