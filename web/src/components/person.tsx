"use client";

import useSWR from "swr";

// Ids asked for in the same tick go to GET /api/people in one request.
let queued: {
  id: string;
  resolve: (name: string | undefined) => void;
  reject: (error: unknown) => void;
}[] = [];

function nameOf(id: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    if (queued.push({ id, resolve, reject }) === 1) queueMicrotask(flush);
  });
}

// At most this many ids per request (the route's limit).
const MAX_IDS = 100;

function flush() {
  const all = queued;
  queued = [];
  const ids = [...new Set(all.map((q) => q.id))];
  for (let at = 0; at < ids.length; at += MAX_IDS) {
    const some = new Set(ids.slice(at, at + MAX_IDS));
    void request(
      [...some],
      all.filter((q) => some.has(q.id)),
    );
  }
}

async function request(ids: string[], batch: typeof queued) {
  try {
    const url = `/api/people?ids=${ids.map(encodeURIComponent).join(",")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    const names = (await res.json()) as Record<string, string>;
    for (const q of batch) q.resolve(names[q.id]);
  } catch (error) {
    for (const q of batch) q.reject(error);
  }
}

/**
 * The name to show for a user id (GET /api/people): who proposed, confirmed
 * or edited, never their raw id. The names on a page are asked for in one
 * request. While it loads, or when it can't be read, 「成員」.
 */
export function Person({ id }: { id: string }) {
  const { data } = useSWR(["person", id], ([, id]) => nameOf(id), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return <>{data ?? "成員"}</>;
}
