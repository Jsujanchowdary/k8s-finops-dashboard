"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight, CircleDollarSign, KeyRound, LayoutDashboard, Package, Search, Server, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { HealthDot } from "@/components/ui/badge";
import type { Health } from "@/lib/k8s/types";

export interface NavNamespace {
  name: string;
  health: Health;
  pods: number;
  attention: number;
}

const OPEN_KEY = "do-dashboard:namespaces-open";

export function SidebarNav({ namespaces, nodeNames, helmCount, certificates, riskyApps }: { namespaces: NavNamespace[]; nodeNames: string[]; helmCount: number; certificates: { count: number; attention: number } | null; riskyApps: number }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  // The namespace list is collapsed until opened; the choice is remembered in this browser.
  const [open, setOpen] = useState(false);
  const [focusSearch, setFocusSearch] = useState(false);
  // Off until the saved choice has been applied, so a list left open does not animate open on every page load.
  const [animate, setAnimate] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Read the saved choice after mount, from a callback, so the first render matches the server.
  useEffect(() => {
    let enable = 0;
    const id = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(OPEN_KEY) === "1") setOpen(true);
      } catch {
        /* storage unavailable: stay collapsed */
      }
      enable = window.setTimeout(() => setAnimate(true), 50);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(enable);
    };
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* not remembered, still works */
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        // Opens the list if needed; the search box is focused once it is on screen.
        setOpen(true);
        setFocusSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open && focusSearch) {
      input.current?.focus();
      const id = window.setTimeout(() => setFocusSearch(false), 0);
      return () => window.clearTimeout(id);
    }
  }, [open, focusSearch]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? namespaces.filter((n) => n.name.toLowerCase().includes(q)) : namespaces;
  }, [namespaces, query]);

  const current = namespaces.find((n) => {
    const href = `/namespaces/${encodeURIComponent(n.name)}`;
    return pathname === href || pathname.startsWith(`${href}/`);
  });
  const attention = namespaces.filter((n) => n.attention > 0);

  // Height and fade animate together; people who ask their system for reduced motion get an instant switch.
  const motion = animate ? "transition-[grid-template-rows,flex-grow,opacity] duration-200 ease-out motion-reduce:transition-none" : "";

  const link = (href: string, active: boolean) =>
    `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${active ? "bg-accent/15 text-text" : "text-muted hover:bg-surface-2 hover:text-text"}`;

  return (
    <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-0.5">
        <Link href="/" className={link("/", pathname === "/")} aria-current={pathname === "/" ? "page" : undefined}>
          <LayoutDashboard className="size-4" /> Overview
        </Link>
        <Link href="/helm" className={link("/helm", pathname === "/helm" || pathname.startsWith("/helm/"))} aria-current={pathname === "/helm" ? "page" : undefined}>
          <Package className="size-4" />
          <span className="flex-1">Helm releases</span>
          <span className="text-xs tabular-nums text-muted">{helmCount}</span>
        </Link>
        {certificates ? (
          <Link href="/certificates" className={link("/certificates", pathname === "/certificates")} aria-current={pathname === "/certificates" ? "page" : undefined}>
            <ShieldCheck className="size-4" />
            <span className="flex-1">Certificates</span>
            {certificates.attention > 0 ? <span className="rounded-full bg-warning/15 px-1.5 text-[11px] tabular-nums text-warning" title={`${certificates.attention} certificate(s) need attention`}>{certificates.attention}</span> : null}
            <span className="text-xs tabular-nums text-muted">{certificates.count}</span>
          </Link>
        ) : null}
        <Link href="/access" className={link("/access", pathname === "/access")} aria-current={pathname === "/access" ? "page" : undefined}>
          <KeyRound className="size-4" />
          <span className="flex-1">Access</span>
          {riskyApps > 0 ? <span className="rounded-full bg-danger/15 px-1.5 text-[11px] tabular-nums text-danger" title={`${riskyApps} app ServiceAccount(s) could take over the cluster`}>{riskyApps}</span> : null}
        </Link>
        {nodeNames.map((name) => {
          const href = `/nodes/${encodeURIComponent(name)}`;
          const active = pathname === href;
          return (
            <Link key={name} href={href} className={link(href, active)} aria-current={active ? "page" : undefined} title={name}>
              <Server className="size-4 shrink-0" />
              <span className="truncate">{name}</span>
            </Link>
          );
        })}
        <Link href="/assistant" className={link("/assistant", pathname === "/assistant")} aria-current={pathname === "/assistant" ? "page" : undefined}>
          <Sparkles className="size-4" />
          <span className="flex-1">AI assistant</span>
        </Link>
        <Link href="/finops" className={link("/finops", pathname === "/finops")} aria-current={pathname === "/finops" ? "page" : undefined}>
          <CircleDollarSign className="size-4" />
          <span className="flex-1">FinOps</span>
        </Link>
        <Link href="/settings" className={link("/settings", pathname === "/settings")} aria-current={pathname === "/settings" ? "page" : undefined}>
          <Settings className="size-4" />
          <span className="flex-1">Settings</span>
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => toggle(!open)}
          aria-expanded={open}
          aria-controls={listId}
          className="mb-2 flex items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-surface-2"
        >
          <ChevronRight className={`size-3.5 shrink-0 text-muted ${animate ? "transition-transform duration-200 ease-out motion-reduce:transition-none" : ""} ${open ? "rotate-90" : ""}`} aria-hidden />
          <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">Namespaces</span>
          {!open && attention.length ? (
            <span className="rounded-full bg-warning/15 px-1.5 text-[11px] tabular-nums text-warning" title={`${attention.length} namespace(s) have pods that need attention: ${attention.map((n) => n.name).join(", ")}`}>{attention.length}</span>
          ) : null}
          <span className="text-xs tabular-nums text-muted">{open && filtered.length !== namespaces.length ? `${filtered.length}/${namespaces.length}` : namespaces.length}</span>
        </button>

        {/* Collapsed: still show where you are. It folds away as the full list opens (rows 1fr -> 0fr). */}
        {current ? (
          <div className={`grid ${motion} ${open ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`} inert={open} aria-hidden={open}>
            <div className="min-h-0 overflow-hidden">
              <Link href={`/namespaces/${encodeURIComponent(current.name)}`} className={link("", true)} aria-current={open ? undefined : "page"} title={current.name}>
                <HealthDot health={current.health} />
                <span className="min-w-0 flex-1 truncate">{current.name}</span>
                {current.attention > 0 ? <span className="rounded-full bg-warning/15 px-1.5 text-[11px] tabular-nums text-warning">{current.attention}</span> : null}
                <span className="text-xs tabular-nums text-muted">{current.pods}</span>
              </Link>
            </div>
          </div>
        ) : null}

        {/* Kept on the page while closed (inert: no mouse, keyboard or screen reader) so closing can animate too.
            It grows from nothing to the space left in the sidebar (flex-grow 0 -> 1) while fading in. */}
        <div
          id={listId}
          inert={!open}
          aria-hidden={!open}
          className={`flex min-h-0 basis-0 flex-col overflow-hidden ${motion} ${open ? "grow opacity-100" : "grow-0 opacity-0"}`}
        >
          <label className="relative mb-2 block">
            <span className="sr-only">Search namespaces</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  input.current?.blur();
                }
              }}
              placeholder="Search namespaces"
              className="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-8 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border px-1 text-[10px] text-muted">/</kbd>
          </label>
          <ul className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
            {filtered.map((n) => {
              const href = `/namespaces/${encodeURIComponent(n.name)}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={n.name}>
                  <Link href={href} className={link(href, active)} aria-current={active ? "page" : undefined} title={n.name}>
                    <HealthDot health={n.health} />
                    <span className="min-w-0 flex-1 truncate">{n.name}</span>
                    {n.attention > 0 ? <span className="rounded-full bg-warning/15 px-1.5 text-[11px] tabular-nums text-warning" title={`${n.attention} pod(s) need attention`}>{n.attention}</span> : null}
                    <span className="text-xs tabular-nums text-muted">{n.pods}</span>
                  </Link>
                </li>
              );
            })}
            {filtered.length === 0 ? <li className="px-2 py-3 text-xs text-muted">No namespace matches “{query}”.</li> : null}
          </ul>
        </div>
      </div>
    </nav>
  );
}
