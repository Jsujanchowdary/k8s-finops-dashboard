"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-xl border border-danger/40 bg-surface p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
        <div>
          <h1 className="text-base font-semibold">Something went wrong</h1>
          <p className="mt-1 break-words text-sm text-muted">{error.message || "Unexpected error while loading this page."}</p>
          {error.digest ? <p className="mt-1 font-mono text-xs text-muted">ref {error.digest}</p> : null}
          <button type="button" onClick={reset} className="mt-4 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-border/40">Try again</button>
        </div>
      </div>
    </div>
  );
}
