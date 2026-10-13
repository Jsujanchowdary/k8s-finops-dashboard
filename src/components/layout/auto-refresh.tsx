"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { parseRefreshSeconds, refreshLabel, refreshOptions } from "@/lib/refresh";

const STORAGE_KEY = "do-dashboard:refresh-seconds";

export function AutoRefresh({ defaultSeconds }: { defaultSeconds: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [seconds, setSeconds] = useState(parseRefreshSeconds(defaultSeconds) ?? 30);
  const [saved, setSaved] = useState<number | undefined>(undefined);
  const [updated, setUpdated] = useState<string | null>(null);

  // A tick is skipped while the previous refresh is still running, so slow answers never pile up.
  const busy = useRef(false);
  useEffect(() => {
    busy.current = pending;
  }, [pending]);

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
      setUpdated(new Date().toLocaleTimeString());
    });
  }, [router]);

  // Read the saved choice after mount, from a callback, so the first render matches the server.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setUpdated(new Date().toLocaleTimeString());
      try {
        const stored = parseRefreshSeconds(window.localStorage.getItem(STORAGE_KEY));
        if (stored !== undefined) {
          setSeconds(stored);
          setSaved(stored);
        }
      } catch {
        /* storage can be unavailable; keep the default */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const tick = () => {
      if (document.visibilityState === "visible" && !busy.current) refresh();
    };
    const id = window.setInterval(tick, seconds * 1000);
    // Coming back to the tab shows fresh data straight away instead of waiting for the next tick.
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [seconds, refresh]);

  const choose = (value: string) => {
    const next = parseRefreshSeconds(value);
    if (next === undefined) return;
    setSeconds(next);
    setSaved(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const options = refreshOptions(defaultSeconds, saved);

  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="hidden tabular-nums lg:inline" suppressHydrationWarning>
        Updated {updated ?? "—"}
      </span>
      <label className="flex items-center gap-2">
        <span className="hidden sm:inline">Auto-refresh</span>
        <span className="relative">
          <select
            value={seconds}
            onChange={(e) => choose(e.target.value)}
            aria-label="Auto-refresh interval"
            className="h-8 appearance-none rounded-md border border-border bg-surface pl-2.5 pr-7 text-xs font-medium text-text focus:border-accent focus:outline-none"
          >
            {options.map((value) => (
              <option key={value} value={value}>{refreshLabel(value)}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
        </span>
      </label>
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-60"
      >
        <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        Refresh
      </button>
    </div>
  );
}
