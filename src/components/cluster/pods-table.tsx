"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Segmented, SearchField } from "@/components/ui/controls";
import { Meter, overRequest, requestScale } from "@/components/ui/meter";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatBytes, formatCpu } from "@/lib/format";
import type { PodRow, ResourceTriple } from "@/lib/k8s/types";

export type PodTableRow = PodRow & { age: string };

type SortKey = "name" | "status" | "restarts" | "cpu" | "memory" | "age" | "namespace";
type StatusFilter = "all" | "attention" | "running" | "pending" | "done" | "failed";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "running", label: "Running" },
  { id: "pending", label: "Pending" },
  { id: "done", label: "Completed" },
  { id: "failed", label: "Failed" },
];

function matchesFilter(row: PodTableRow, filter: StatusFilter): boolean {
  switch (filter) {
    case "attention": return row.health === "critical" || row.health === "warning";
    case "running": return row.phase === "Running";
    case "pending": return row.phase === "Pending";
    case "done": return row.phase === "Succeeded";
    case "failed": return row.phase === "Failed" || row.health === "critical";
    default: return true;
  }
}

function UsageCell({ value, kind, show }: { value: ResourceTriple; kind: "cpu" | "memory"; show: boolean }) {
  const f = kind === "cpu" ? formatCpu : formatBytes;
  // No limit means no ceiling to be close to: scale the bar to fit and keep it neutral.
  const { max: ceiling, colorize } = requestScale(value);
  // With neither a request nor a limit there is nothing to compare usage with, so no bar.
  const hasReference = value.limit > 0 || value.request > 0;
  const over = show && overRequest(value);
  return (
    <div className="w-36">
      <div className="flex justify-between text-xs tabular-nums">
        <span className={over ? "text-warning" : undefined} title={over ? `Using ${Math.round(((value.usage ?? 0) / value.request) * 100)}% of its request` : undefined}>{show && value.usage !== null ? f(value.usage) : "—"}</span>
        <span className="text-muted">{value.request ? `${f(value.request)} req` : "no req"}</span>
      </div>
      {ceiling && show && hasReference ? <div className="mt-1"><Meter usage={value.usage} request={value.request} max={ceiling} colorize={colorize} height="h-1" label={`${kind} usage`} /></div> : null}
    </div>
  );
}

export function PodsTable({ rows, showNamespace = false, showNode = true, metricsAvailable }: { rows: PodTableRow[]; showNamespace?: boolean; showNode?: boolean; metricsAvailable: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (!matchesFilter(r, filter)) return false;
      if (!q) return true;
      return [r.name, r.namespace, r.status, r.release, r.commit, r.nodeName, r.podIp, r.owner?.name, ...r.images].some((v) => v?.toLowerCase().includes(q));
    });
    const compare: Record<SortKey, (a: PodTableRow, b: PodTableRow) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      namespace: (a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name),
      status: (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
      restarts: (a, b) => a.restarts - b.restarts,
      cpu: (a, b) => (a.cpu.usage ?? -1) - (b.cpu.usage ?? -1),
      memory: (a, b) => (a.memory.usage ?? -1) - (b.memory.usage ?? -1),
      age: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    return [...list].sort((a, b) => compare[sort.key](a, b) * sort.dir);
  }, [rows, query, filter, sort]);

  // Only show the column when at least one pod here carries a commit (system pods do not).
  const showCommit = useMemo(() => rows.some((r) => r.commit), [rows]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter((r) => matchesFilter(r, f.id)).length])) as Record<StatusFilter, number>, [rows]);

  const header = (key: SortKey, label: string) => (
    <Th>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-text" aria-label={`Sort by ${label}`}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : null}
      </button>
    </Th>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} label="Search pods" placeholder="Search by name, release, commit, image, node or IP" className="sm:max-w-sm" />
        <Segmented
          label="Filter pods by status"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: counts[f.id] }))}
        />
        <span className="ml-auto text-xs tabular-nums text-muted">Showing {visible.length} of {rows.length} pods</span>
      </div>

      <Card>
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            {rows.length === 0 ? "This namespace has no pods." : "No pod matches your search."}
            {rows.length > 0 ? <> <button type="button" className="text-accent hover:underline" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button></> : null}
          </div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  {header("name", "Name")}
                  {showNamespace ? header("namespace", "Namespace") : null}
                  <Th>Ready</Th>
                  {header("status", "Status")}
                  {showCommit ? <Th>Commit</Th> : null}
                  {header("restarts", "Restarts")}
                  {showNode ? <Th>Node</Th> : null}
                  <Th>Pod IP</Th>
                  {header("cpu", "CPU")}
                  {header("memory", "Memory")}
                  {header("age", "Age")}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const [ready, total] = r.ready.split("/");
                  return (
                    <tr key={`${r.namespace}/${r.name}`} className="hover:bg-surface-2/60">
                      <Td>
                        <Link href={`/namespaces/${encodeURIComponent(r.namespace)}/pods/${encodeURIComponent(r.name)}`} className="font-mono text-xs font-medium hover:text-accent">{r.name}</Link>
                        {r.owner ? <div className="mt-0.5 text-[11px] text-muted">{r.owner.kind} · {r.owner.name}</div> : null}
                      </Td>
                      {showNamespace ? <Td mono><Link href={`/namespaces/${encodeURIComponent(r.namespace)}`} className="hover:text-accent">{r.namespace}</Link></Td> : null}
                      <Td className={`tabular-nums ${ready !== total && r.phase !== "Succeeded" ? "text-warning" : ""}`}>{r.ready}</Td>
                      <Td><StatusBadge status={r.status} health={r.health} /></Td>
                      {showCommit ? <Td mono>{r.commit ? <span title={r.commit}>{r.commit.slice(0, 7)}</span> : <span className="text-muted">—</span>}</Td> : null}
                      <Td className={`tabular-nums ${r.restarts >= 5 ? "text-warning" : r.restarts > 0 ? "" : "text-muted"}`}>{r.restarts}</Td>
                      {showNode ? <Td mono>{r.nodeName ?? <span className="text-muted">—</span>}</Td> : null}
                      <Td mono>{r.podIp ?? <span className="text-muted">—</span>}</Td>
                      <Td><UsageCell value={r.cpu} kind="cpu" show={metricsAvailable} /></Td>
                      <Td><UsageCell value={r.memory} kind="memory" show={metricsAvailable} /></Td>
                      <Td className="tabular-nums text-muted">{r.age}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
