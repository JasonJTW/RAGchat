"use client";

import { Fragment, useRef, useState } from "react";
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

interface ChunkSummary {
  path: string[];
  preview: string;
}

/** The admin session is missing or expired (the server restarted). */
class Unauthorized extends Error {}

/** Any other failed request, with its HTTP status. */
class RequestFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function adminFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok)
    throw new RequestFailed(
      `${init?.method ?? "GET"} ${url}: ${res.status}`,
      res.status,
    );
  return res;
}

// What the admin sees when the server refuses an upload, by status.
const UPLOAD_ERRORS: Record<number, string> = {
  400: "一次最多上傳 10 份",
  413: "單一檔案最大 5 MB",
  415: "不支援的檔案格式",
};

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
  const [expanded, setExpanded] = useState<string | null>(null);

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
      else
        setError(
          (e instanceof RequestFailed && UPLOAD_ERRORS[e.status]) ||
            "上傳失敗，請再試一次",
        );
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await adminFetch(`/api/documents/${id}`, { method: "DELETE" });
      await mutate();
    } catch (e) {
      if (e instanceof Unauthorized) router.replace("/admin/login");
      else setError("刪除失敗，請再試一次");
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
            <th>類型</th>
            <th>段落數</th>
            <th>上傳時間</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <Fragment key={doc.id}>
              <tr>
                <td>{doc.filename}</td>
                <td>{documentType(doc.filename)}</td>
                <td>
                  {doc.chunkCount}
                  {doc.chunkCount === 0 && (
                    <span className="ml-2 text-red-600">無法抽出文字</span>
                  )}
                </td>
                <td>{new Date(doc.uploadedAt).toLocaleString("zh-TW")}</td>
                <td>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={expanded === doc.id}
                    onClick={() =>
                      setExpanded(expanded === doc.id ? null : doc.id)
                    }
                  >
                    查看段落
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-2"
                    onClick={() => remove(doc.id)}
                  >
                    刪除
                  </Button>
                </td>
              </tr>
              {expanded === doc.id && (
                <tr>
                  <td colSpan={5}>
                    <ChunkList document={doc} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TYPES: Record<string, string> = {
  md: "Markdown",
  pdf: "PDF",
  txt: "純文字",
};

function documentType(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  return TYPES[extension] ?? extension;
}

/** Read-only view of a document's chunks: heading path and first 80 characters. */
function ChunkList({ document }: { document: DocumentSummary }) {
  const { data: chunks } = useSWR<ChunkSummary[]>(
    `/api/documents/${document.id}/chunks`,
    fetchJson,
  );
  if (!chunks) return <p className="text-muted-foreground">載入中…</p>;
  return (
    <ol
      aria-label={`${document.filename} 的段落`}
      className="flex flex-col gap-3 py-2"
    >
      {chunks.map((chunk, i) => (
        <li key={i}>
          <h3 className="font-medium">{chunk.path.join(" › ")}</h3>
          <p className="text-muted-foreground whitespace-pre-wrap">
            {chunk.preview}
          </p>
        </li>
      ))}
    </ol>
  );
}
