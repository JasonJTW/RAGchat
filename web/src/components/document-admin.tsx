"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";

interface DocumentSummary {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedAt: string;
}

/** The admin session is missing or expired (the server restarted). */
class Unauthorized extends Error {}

async function adminFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok)
    throw new Error(`${init?.method ?? "GET"} ${url}: ${res.status}`);
  return res;
}

const fetchJson = (url: string) => adminFetch(url).then((res) => res.json());

export function DocumentAdmin() {
  const router = useRouter();
  const {
    data: documents = [],
    isLoading,
    mutate,
  } = useSWR<DocumentSummary[]>("/api/documents", fetchJson, {
    // Only fires for a failed request, never for the 401 SWR keeps cached
    // from before logging in.
    onError: (e) => {
      if (e instanceof Unauthorized) router.replace("/admin/login");
    },
  });
  const input = useRef<HTMLInputElement>(null);
  const hydrated = useHydrated();
  const [selected, setSelected] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearSelection() {
    setSelected([]);
    if (input.current) input.current.value = "";
  }

  async function upload() {
    const body = new FormData();
    for (const file of selected) body.append("files", file);
    setError(null);
    setUploading(true);
    try {
      await adminFetch("/api/documents", { method: "POST", body });
      clearSelection();
      await mutate();
    } catch (e) {
      if (e instanceof Unauthorized) router.replace("/admin/login");
      else setError("上傳失敗，請再試一次");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          setError(null);
          setSelected(Array.from(e.currentTarget.files ?? []));
        }}
      />
      {selected.length === 0 ? (
        <Button
          className="self-start"
          disabled={!hydrated}
          onClick={() => input.current?.click()}
        >
          選擇檔案
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="text-sm">
            {selected.map((file) => (
              <li key={file.name}>{file.name}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button onClick={upload} disabled={uploading}>
              {uploading ? "處理中…" : "上傳"}
            </Button>
            <Button
              variant="outline"
              onClick={clearSelection}
              disabled={uploading}
            >
              取消
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <table aria-busy={isLoading} className="w-full text-left text-sm">
        <thead>
          <tr>
            <th>檔名</th>
            <th>段落數</th>
            <th>上傳時間</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id}>
              <td>{doc.filename}</td>
              <td>{doc.chunkCount}</td>
              <td>{new Date(doc.uploadedAt).toLocaleString("zh-TW")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
