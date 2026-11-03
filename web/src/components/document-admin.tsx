"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";

interface DocumentSummary {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedAt: string;
}

const fetchJson = (url: string) => fetch(url).then((res) => res.json());

// False in the server-rendered HTML, true once React has hydrated. Until then
// the button has no click handler, so it stays disabled instead of ignoring clicks.
const noopSubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function DocumentAdmin() {
  const { data: documents = [], mutate } = useSWR<DocumentSummary[]>(
    "/api/documents",
    fetchJson,
  );
  const input = useRef<HTMLInputElement>(null);
  const hydrated = useHydrated();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    const files = input.current?.files;
    if (!files?.length) {
      setError("請先選擇檔案");
      return;
    }
    const body = new FormData();
    for (const file of files) body.append("files", file);
    setError(null);
    setUploading(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      if (input.current) input.current.value = "";
      await mutate();
    } catch {
      setError("上傳失敗，請再試一次");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <input ref={input} type="file" multiple aria-label="選擇檔案" />
        <Button onClick={upload} disabled={!hydrated || uploading}>
          {uploading ? "處理中…" : "上傳"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <table className="w-full text-left text-sm">
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
