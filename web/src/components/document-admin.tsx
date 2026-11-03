"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";

interface DocumentSummary {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedAt: string;
}

const fetchJson = (url: string) => fetch(url).then((res) => res.json());

export function DocumentAdmin() {
  const { data: documents = [], mutate } = useSWR<DocumentSummary[]>(
    "/api/documents",
    fetchJson,
  );
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    const files = input.current?.files;
    if (!files?.length) return;
    const body = new FormData();
    for (const file of files) body.append("files", file);
    setUploading(true);
    try {
      await fetch("/api/documents", { method: "POST", body });
      if (input.current) input.current.value = "";
      await mutate();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <input ref={input} type="file" multiple aria-label="選擇檔案" />
        <Button onClick={upload} disabled={uploading}>
          {uploading ? "處理中…" : "上傳"}
        </Button>
      </div>
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
