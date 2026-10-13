"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";
import { search, type SearchEntry, type SearchResult } from "@/lib/search-match";

/**
 * Cmd+K (Ctrl+K) search across everything the dashboard shows. The index arrives from the server with the page;
 * matching runs in the browser, so typing never waits on the network.
 */
export function GlobalSearch({ index }: { index: SearchEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // Known only in the browser; read after mount so the first render matches the server.
  useEffect(() => {
    const id = window.setTimeout(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), 0);
    return () => window.clearTimeout(id);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const results: SearchResult[] = useMemo(
    () => (query.trim() ? search(index, query) : index.filter((e) => e.kind === "Page").map((entry) => ({ entry, score: 0 }))),
    [index, query],
  );

  // Keep the highlighted row in view while moving with the arrow keys.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (r: SearchResult | undefined) => {
    if (!r) return;
    close();
    router.push(r.entry.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-56 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-sm text-muted transition-colors hover:border-accent/60 hover:text-text"
        aria-label="Search everything"
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-border px-1 font-sans text-[10px]">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      {/* Rendered on <body>: inside the top bar, its backdrop-blur would make the "full-screen" overlay only as tall
          as the bar. */}
      {open ? createPortal(
        <div className="glass-backdrop fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div role="dialog" aria-modal="true" aria-label="Search everything" className="glass-panel w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="glass-divider flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 shrink-0 text-muted" />
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Pods, workloads, services, hosts, IPs, images, commits, pages…"
                className="h-12 w-full bg-transparent text-sm placeholder:text-muted"
                // The open dialog already shows where typing goes; the global focus ring would box in the field.
                style={{ outline: "none" }}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
                aria-autocomplete="list"
                spellCheck={false}
                autoComplete="off"
              />
              <kbd className="shrink-0 rounded border border-border px-1.5 text-[10px] text-muted">Esc</kbd>
            </div>

            <ul ref={list} id={listId} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto py-1.5">
              {!query.trim() ? <li className="px-4 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted" role="presentation">Go to</li> : null}
              {results.map((r, i) => (
                <li
                  key={`${r.entry.kind}|${r.entry.href}|${r.entry.title}`}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(r)}
                  className={`mx-1.5 flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 ${i === active ? "bg-accent/15" : ""}`}
                >
                  <span className="w-24 shrink-0 text-[11px] text-muted">{r.entry.kind}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${r.entry.kind === "Page" ? "font-medium" : "font-mono"}`}>{r.entry.title}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {r.entry.subtitle}
                      {r.matched && r.matched.label !== "page" ? (
                        <>
                          {r.entry.subtitle ? " · " : ""}
                          {r.matched.label} <span className="font-mono text-text">{r.matched.value}</span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {i === active ? <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden /> : null}
                </li>
              ))}
              {query.trim() && results.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted" role="presentation">Nothing matches “{query.trim()}”.</li> : null}
            </ul>

            <div className="glass-divider flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted">
              <span><kbd className="font-sans">↑↓</kbd> move</span>
              <span><kbd className="font-sans">Enter</kbd> open</span>
              <span><kbd className="font-sans">Esc</kbd> close</span>
              <span className="ml-auto">{query.trim() ? `${results.length}${results.length === 40 ? "+" : ""} result${results.length === 1 ? "" : "s"}` : `${index.length - results.length} things indexed`}</span>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
