"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Globe, HardDrive, Network, RotateCcw } from "lucide-react";
import { Badge, HealthDot, healthTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Segmented, SearchField, SelectField } from "@/components/ui/controls";
import { Meter, overRequest, requestScale } from "@/components/ui/meter";
import { formatBytes, formatCpu } from "@/lib/format";
import type { NamespaceView } from "@/lib/k8s/types";

type SortKey = "name" | "pods" | "cpu" | "memory" | "attention";
type Filter = "all" | "attention" | "pods" | "app";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "attention", label: "Needs attention" },
  { id: "pods", label: "Pods" },
  { id: "cpu", label: "CPU requested" },
  { id: "memory", label: "Memory requested" },
];

/** Marks the part of `text` that matches the search, so it is clear why a card is shown. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-accent/30 px-0.5 text-text">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

const isSystem = (name: string) => name.startsWith("kube-") || name === "default";

/**
 * Applies a filter or sort change through the browser's View Transitions, so cards glide to their new places and
 * fade in or out. Instant where the API is missing or the viewer asks for reduced motion. Typing in the search box is
 * not animated (it would make typing lag), and neither is the auto-refresh, which goes through React, not this.
 */
function withTransition(update: () => void) {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof document === "undefined" || !document.startViewTransition) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}

export function NamespaceExplorer({ namespaces }: { namespaces: NamespaceView[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSortNow] = useState<SortKey>("name");
  const [filter, setFilterNow] = useState<Filter>("all");
  const setSort = (v: SortKey) => withTransition(() => setSortNow(v));
  const setFilter = (v: Filter) => withTransition(() => setFilterNow(v));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = namespaces.filter((n) => !q || n.name.toLowerCase().includes(q));
    if (filter === "attention") list = list.filter((n) => n.pods.unhealthy > 0 || n.health === "critical");
    if (filter === "pods") list = list.filter((n) => n.pods.total > 0);
    if (filter === "app") list = list.filter((n) => !isSystem(n.name));
    const by: Record<SortKey, (a: NamespaceView, b: NamespaceView) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      attention: (a, b) => b.pods.unhealthy - a.pods.unhealthy || a.name.localeCompare(b.name),
      pods: (a, b) => b.pods.total - a.pods.total || a.name.localeCompare(b.name),
      cpu: (a, b) => b.cpu.request - a.cpu.request || a.name.localeCompare(b.name),
      memory: (a, b) => b.memory.request - a.memory.request || a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sort]);
  }, [namespaces, query, sort, filter]);

  const counts = useMemo(
    () => ({
      all: namespaces.length,
      app: namespaces.filter((n) => !isSystem(n.name)).length,
      pods: namespaces.filter((n) => n.pods.total > 0).length,
      attention: namespaces.filter((n) => n.pods.unhealthy > 0 || n.health === "critical").length,
    }),
    [namespaces],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} label="Search namespaces" placeholder="Search namespaces" className="sm:max-w-xs" />
        <Segmented
          label="Filter namespaces"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: counts.all },
            { id: "app", label: "Apps only", count: counts.app },
            { id: "pods", label: "With pods", count: counts.pods },
            { id: "attention", label: "Needs attention", count: counts.attention },
          ]}
        />
        <div className="ml-auto">
          <SelectField label="Sort by" value={sort} onChange={(v) => setSort(v as SortKey)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </SelectField>
        </div>
      </div>

      <p className="mb-3 text-xs text-muted">Showing {visible.length} of {namespaces.length} namespaces</p>

      {visible.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted">
          No namespace matches your search.{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => { setQuery(""); setFilterNow("all"); }}>
            Clear filters
          </button>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {visible.map((n) => (
            <li key={n.name} style={{ viewTransitionName: `ns-card-${n.name}` }}>
              <Link
                href={`/namespaces/${encodeURIComponent(n.name)}`}
                className="block h-full rounded-xl border border-border bg-surface p-4 transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-accent/60 hover:bg-surface-2 hover:shadow-lg hover:shadow-black/10 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <HealthDot health={n.health} className="size-2" pulse={n.health === "critical" || n.health === "warning"} />
                    <h3 className="truncate text-sm font-semibold"><Highlight text={n.name} query={query} /></h3>
                  </div>
                  {n.pods.unhealthy > 0 ? <Badge tone={healthTone(n.health)}>{n.pods.unhealthy} need attention</Badge> : n.pods.total === 0 ? <Badge>empty</Badge> : <Badge tone="success">healthy</Badge>}
                </div>

                <p className="mt-2 text-xs text-muted">
                  <span className="tabular-nums text-text">{n.pods.running}</span>/{n.pods.total} {n.pods.total === 1 ? "pod" : "pods"} running
                  {n.pods.pending ? ` · ${n.pods.pending} pending` : ""}
                  {n.pods.failed ? ` · ${n.pods.failed} failed` : ""}
                  {n.restarts ? <span className="ml-1 inline-flex items-center gap-0.5"><RotateCcw className="size-3" />{n.restarts}</span> : null}
                </p>

                {n.pods.total > 0 ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="mb-1 flex justify-between"><span className="font-medium">CPU</span><span className="tabular-nums text-muted"><UsageValue value={n.cpu} text={n.cpu.usage === null ? "—" : formatCpu(n.cpu.usage)} /> / {n.cpu.request ? `${formatCpu(n.cpu.request)} req` : "no req"}</span></div>
                      <RequestBar value={n.cpu} label={`${n.name} CPU used against requested`} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between"><span className="font-medium">Memory</span><span className="tabular-nums text-muted"><UsageValue value={n.memory} text={n.memory.usage === null ? "—" : formatBytes(n.memory.usage)} /> / {n.memory.request ? `${formatBytes(n.memory.request)} req` : "no req"}</span></div>
                      <RequestBar value={n.memory} label={`${n.name} memory used against requested`} />
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {n.counts.deployments + n.counts.statefulsets + n.counts.daemonsets > 0 ? <span>{n.counts.deployments + n.counts.statefulsets + n.counts.daemonsets} {n.counts.deployments + n.counts.statefulsets + n.counts.daemonsets === 1 ? "workload" : "workloads"}</span> : null}
                  {n.counts.services > 0 ? <span className="inline-flex items-center gap-1"><Network className="size-3" />{n.counts.services} svc</span> : null}
                  {n.counts.ingresses > 0 ? <span className="inline-flex items-center gap-1"><Globe className="size-3" />{n.counts.ingresses} ingress</span> : null}
                  {n.counts.pvcs > 0 ? <span className="inline-flex items-center gap-1"><HardDrive className="size-3" />{n.counts.pvcs} pvc · {formatBytes(n.storageBytes)}</span> : null}
                  {n.warningEvents > 0 ? <span className="text-warning">{n.warningEvents} warning events (24h)</span> : null}
                </div>
                {n.hosts.length ? <p className="mt-2 truncate font-mono text-[11px] text-muted" title={n.hosts.join(", ")}>{n.hosts.join(" · ")}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The used amount, in amber with an explanation when it is above what the namespace requests. */
function UsageValue({ value, text }: { value: { request: number; usage: number | null }; text: string }) {
  if (!overRequest(value)) return <>{text}</>;
  return <span className="text-warning" title={`Using ${Math.round(((value.usage ?? 0) / value.request) * 100)}% of what it requests`}>{text}</span>;
}

/**
 * Usage against the request. Without a request there is nothing to compare usage with, so no bar
 * (the same rule as the pod table): a bar scaled to usage alone would always look 80% full.
 */
function RequestBar({ value, label }: { value: { request: number; limit: number; usage: number | null }; label: string }) {
  if (!value.request) return <p className="flex h-1.5 items-center text-[11px] leading-none text-muted" title="No pod here requests this, so the scheduler reserves nothing for it">nothing requested</p>;
  return <Meter usage={value.usage} request={value.request} max={requestScale(value, false).max} colorize={false} height="h-1.5" label={label} />;
}
