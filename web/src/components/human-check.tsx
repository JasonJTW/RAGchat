"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// Cloudflare Turnstile before a 訪客's trial (server/src/turnstile.ts checks
// the token). Without NEXT_PUBLIC_TURNSTILE_SITE_KEY (tests, E2E) it is a
// plain button sending the token the server's stub check passes
// (STUB_TURNSTILE=1); a real server refuses that token.

const STUB_TOKEN = "stub-pass";

declare global {
  interface Window {
    turnstile?: {
      render(
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
        },
      ): string;
      reset(widgetId?: string): void;
    };
  }
}

/** The human check; `onPassed` runs once the server accepted it. */
export function HumanCheck({ onPassed }: { onPassed: () => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = useCallback(
    async (token: string) => {
      setBusy(true);
      setError("");
      const res = await fetch("/api/trial/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setBusy(false);
      if (res.ok) return onPassed();
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "人機驗證失敗，請重新整理再試一次。");
    },
    [onPassed],
  );

  return (
    <div className="flex flex-col gap-2">
      {siteKey ? (
        <TurnstileWidget siteKey={siteKey} onToken={verify} />
      ) : (
        <Button
          type="button"
          className="self-start"
          disabled={busy}
          onClick={() => void verify(STUB_TOKEN)}
        >
          開始試用（測試模式的人機驗證）
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(
    () => typeof window !== "undefined" && !!window.turnstile,
  );
  useEffect(() => {
    if (!loaded || !box.current || !window.turnstile) return;
    const element = box.current;
    element.replaceChildren();
    window.turnstile.render(element, { sitekey: siteKey, callback: onToken });
  }, [loaded, siteKey, onToken]);
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setLoaded(true)}
      />
      <div ref={box} aria-label="人機驗證" />
    </>
  );
}
