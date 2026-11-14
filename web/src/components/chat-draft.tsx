"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

// A message put in the chat box from outside it (e.g. the trial guide's
// example questions and file), for the member or 訪客 to send.

/** What to put in the chat box: a text, and files to attach. */
export interface Draft {
  text: string;
  files: File[];
}

const DraftContext = createContext<{
  draft: Draft | null;
  setDraft: (draft: Draft) => void;
}>({ draft: null, setDraft: () => {} });

export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // The chat takes each new draft once (it compares by identity).
  return (
    <DraftContext.Provider value={{ draft, setDraft }}>
      {children}
    </DraftContext.Provider>
  );
}

/** The latest draft, and the setter to put a new one in. */
export const useDraft = () => useContext(DraftContext);
