"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Badge, HealthDot } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BUTTON, Segmented, SearchField } from "@/components/ui/controls";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import type { Health, HelmReleaseView } from "@/lib/k8s/types";
import { HelmStatusBadge } from "./helm-parts";

export type HelmRow = HelmReleaseView & { updated: string };
type Filter = "all" | "deployed" | "other" | "attention";

const SEVERITY: Record<Health, number> = { critical: 3, warning: 2, unknown: 1, healthy: 0 };

interface Group {
  namespace: string;
  releases: HelmRow[];
  health: Health;
  failed: number;
  attention: number;
}

export function HelmTable({ releases }: { releases: HelmRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // Groups the user opened or closed by hand. Anything not in here follows the default (see isOpen).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const counts = useMemo(
    () => ({
      all: releases.length,
      deployed: releases.filter((r) => r.status === "deployed").length,
      other: releases.filter((r) => r.status !== undefined && r.status !== "deployed").length,
      attention: releases.filter((r) => r.health === "critical" || r.health === "warning").length,
    }),
    [releases],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return releases.filter((r) => {
      if (filter === "deployed" && r.status !== "deployed") return false;
      if (filter === "other" && (r.status === undefined || r.status === "deployed")) return false;
      if (filter === "attention" && r.health !== "critical" && r.health !== "warning") return false;
      if (!q) return true;
      return [r.name, r.namespace, ...r.commits, ...r.images].some((v) => v.toLowerCase().includes(q));
    });
  }, [releases, query, filter]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, HelmRow[]>();
    for (const r of visible) map.set(r.namespace, [...(map.get(r.namespace) ?? []), r]);
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([namespace, list]) => ({
        namespace,
        releases: list,
        health: list.reduce<Health>((worst, r) => (SEVERITY[r.health] > SEVERITY[worst] ? r.health : worst), "healthy"),
        failed: list.filter((r) => r.status === "failed").length,
        attention: list.filter((r) => r.health === "critical" || r.health === "warning").length,
      }));
  }, [visible]);

  // Collapsed by default. While searching or filtering, groups with matches open by themselves, and a new
  // search or filter forgets earlier manual choices so the matches are always visible.
  const searching = query.trim() !== "" || filter !== "all";
  const isOpen = (namespace: string) => toggled[namespace] ?? searching;
  const setAll = (open: boolean) => setToggled(Object.fromEntries(groups.map((g) => [g.namespace, open])));
  const openCount = groups.filter((g) => isOpen(g.namespace)).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={(v) => { setQuery(v); setToggled({}); }} label="Search Helm releases" placeholder="Search by release, namespace, commit or image" className="sm:max-w-sm" />
        <Segmented
          label="Filter releases"
          value={filter}
          onChange={(id) => { setFilter(id); setToggled({}); }}
          options={[
            { id: "all", label: "All", count: counts.all },
            { id: "deployed", label: "Deployed", count: counts.deployed },
            { id: "other", label: "Not deployed", count: counts.other },
            { id: "attention", label: "Needs attention", count: counts.attention },
          ]}
        />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted">{visible.length} of {releases.length} releases · {groups.length} {groups.length === 1 ? "namespace" : "namespaces"}</span>
          <button type="button" className={BUTTON} onClick={() => setAll(openCount < groups.length)} disabled={groups.length === 0}>
            {openCount < groups.length ? "Expand all" : "Collapse all"}
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <Card><p className="px-4 py-10 text-center text-sm text-muted">No release matches.</p></Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const open = isOpen(g.namespace);
            const panel = `helm-group-${g.namespace}`;
            return (
              <Card key={g.namespace} className="overflow-hidden">
                <div className="flex items-center gap-2 pr-3 hover:bg-surface-2/50">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panel}
                    onClick={() => setToggled((t) => ({ ...t, [g.namespace]: !open }))}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    <ChevronRight className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
                    <HealthDot health={g.health} className="size-2" />
                    <span className="truncate font-mono text-sm font-semibold">{g.namespace}</span>
                    <span className="text-xs text-muted">{g.releases.length} {g.releases.length === 1 ? "release" : "releases"}</span>
                    {g.failed > 0 ? <Badge tone="danger">{g.failed} failed</Badge> : null}
                    {g.attention > g.failed ? <Badge tone="warning">{g.attention - g.failed} need attention</Badge> : null}
                  </button>
                  <Link href={`/namespaces/${encodeURIComponent(g.namespace)}`} title={`Open namespace ${g.namespace}`} aria-label={`Open namespace ${g.namespace}`} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>

                {open ? (
                  <div id={panel} className="border-t border-border">
                    <TableWrap>
                      <Table fixed>
                        <colgroup>
                          <col />
                          <col className="w-24" />
                          <col className="w-32" />
                          <col className="w-24" />
                          <col className="w-28" />
                          <col className="w-20" />
                          <col className="w-28" />
                        </colgroup>
                        <thead>
                          <tr><Th>Release</Th><Th>Revision</Th><Th>Status</Th><Th>Updated</Th><Th>Workloads</Th><Th>Pods</Th><Th>Commit</Th></tr>
                        </thead>
                        <tbody>
                          {g.releases.map((r) => (
                            <tr key={r.name} className="hover:bg-surface-2/60">
                              <Td mono className="overflow-hidden">
                                <span className="flex min-w-0 items-center gap-2">
                                  <HealthDot health={r.health} />
                                  <Link href={`/helm/${encodeURIComponent(r.namespace)}/${encodeURIComponent(r.name)}`} title={r.name} className="truncate font-medium hover:text-accent">{r.name}</Link>
                                </span>
                              </Td>
                              <Td className="tabular-nums">{r.revision !== undefined ? `#${r.revision}` : <span className="text-muted">—</span>}</Td>
                              <Td><HelmStatusBadge status={r.status} /></Td>
                              <Td className="tabular-nums text-muted">{r.updated}</Td>
                              <Td className="tabular-nums">{r.workloads.length}</Td>
                              <Td className={`tabular-nums ${r.pods.unhealthy ? "text-warning" : ""}`}>{r.pods.ready}/{r.pods.total}</Td>
                              <Td mono>{r.commits.length ? r.commits.map((c) => c.slice(0, 7)).join(", ") : <span className="text-muted">—</span>}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </TableWrap>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
