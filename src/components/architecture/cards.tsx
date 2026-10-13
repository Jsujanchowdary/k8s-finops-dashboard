"use client";

import Link from "next/link";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Cable, Cloud, Globe, HardDrive, Layers, Lock, Network, Router, Signpost, type LucideIcon } from "lucide-react";
import { formatBytes, formatCpu } from "@/lib/format";
import type { Health } from "@/lib/k8s/types";
import { factHeight, POD_ROW_GAP, POD_ROW_HEIGHT, shownFacts, WORKLOAD_PADDING, workloadHeaderHeight } from "@/lib/topology/sizes";
import type { PlacedNode, TopoKind, TopoPod } from "@/lib/topology/types";

export interface CardData extends Record<string, unknown> {
  node: PlacedNode;
  /** Ids to keep lit while a path is being traced. null when nothing is selected. */
  lit: Set<string> | null;
  selected: string | null;
}

export type CardNode = Node<CardData, "card">;

const ICONS: Record<TopoKind, LucideIcon> = {
  internet: Globe,
  loadbalancer: Network,
  controller: Router,
  ingress: Signpost,
  service: Cable,
  workload: Layers,
  pvc: HardDrive,
  external: Cloud,
};

// Icon chip colours per kind: public entry points blue, routing teal, workloads neutral, storage amber.
const CHIP: Record<TopoKind, string> = {
  internet: "bg-surface-2 text-muted",
  loadbalancer: "bg-accent/15 text-accent",
  controller: "bg-accent/15 text-accent",
  ingress: "bg-accent/15 text-accent",
  service: "bg-info/15 text-info",
  workload: "bg-surface-2 text-text",
  pvc: "bg-warning/15 text-warning",
  external: "bg-surface-2 text-muted",
};

const DOT: Record<Health, string> = { healthy: "bg-success", warning: "bg-warning", critical: "bg-danger", unknown: "bg-muted/60" };
const BORDER: Record<Health, string> = { healthy: "border-border", warning: "border-warning/60", critical: "border-danger/60", unknown: "border-border" };

// Handles exist only so edges have somewhere to attach, so they are invisible.
const HANDLE = "!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

function Anchors() {
  return (
    <>
      <Handle id="l" type="target" position={Position.Left} isConnectable={false} className={HANDLE} />
      <Handle id="r" type="source" position={Position.Right} isConnectable={false} className={HANDLE} />
      <Handle id="sl" type="source" position={Position.Left} isConnectable={false} className={HANDLE} />
      <Handle id="t" type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      <Handle id="b" type="target" position={Position.Bottom} isConnectable={false} className={HANDLE} />
    </>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded border border-border bg-surface-2 px-1 text-[10px] font-medium leading-4 text-muted">{children}</span>;
}

function Header({ node }: { node: PlacedNode }) {
  const Icon = ICONS[node.kind];
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${CHIP[node.kind]}`}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <span className="min-w-0 flex-1 text-[13px] font-semibold leading-5 [overflow-wrap:anywhere]" title={node.title}>{node.title}</span>
          {node.tags.map((t) => (
            <Tag key={t}>{t === "TLS" ? <span className="inline-flex items-center gap-0.5"><Lock className="size-2.5" aria-hidden />TLS</span> : t}</Tag>
          ))}
        </div>
        {node.subtitle ? <div className="truncate text-[11px] leading-4 text-muted">{node.subtitle}</div> : null}
      </div>
      {node.health !== "unknown" ? <span aria-label={node.health} title={node.health} className={`mt-2 size-2 shrink-0 rounded-full ${DOT[node.health]}`} /> : null}
    </div>
  );
}

function Facts({ node }: { node: PlacedNode }) {
  const facts = shownFacts(node);
  if (facts.length === 0) return null;
  return (
    <dl className="mt-1.5 border-t border-border/70 pt-1">
      {facts.map((f, i) => (
        <div key={`${f.label}-${i}`} className="flex items-start gap-2 text-[11px]" style={{ height: factHeight(node.kind, f) }}>
          <dt className="w-14 shrink-0 leading-[14px] text-muted">{f.label}</dt>
          <dd className={`min-w-0 flex-1 leading-[14px] [overflow-wrap:anywhere] ${f.mono ? "font-mono text-[10.5px]" : ""}`} title={f.value}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PodRowCard({ pod, workload, lit, selected }: { pod: TopoPod; workload: string; lit: Set<string> | null; selected: boolean }) {
  const prefix = `${workload}-`;
  const short = pod.name.startsWith(prefix) && pod.name.length - prefix.length >= 6 ? `…${pod.name.slice(prefix.length - 1)}` : pod.name;
  const dim = lit !== null && !lit.has(pod.id);
  return (
    <div
      data-pod-id={pod.id}
      style={{ height: POD_ROW_HEIGHT }}
      className={`relative cursor-pointer rounded-lg border bg-surface px-2.5 py-1.5 transition-opacity ${pod.inService ? BORDER[pod.health] : "border-dashed border-danger/50"} ${selected ? "ring-2 ring-accent" : ""} ${dim ? "opacity-30" : ""}`}
    >
      <Handle id={`in:${pod.id}`} type="target" position={Position.Left} isConnectable={false} className={HANDLE} />
      <div className="flex items-center gap-1.5">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[pod.health]}`} />
        <Link href={pod.href} title={pod.name} className="nodrag nopan min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium hover:text-accent hover:underline">{short}</Link>
        <span className={`shrink-0 text-[10.5px] font-medium ${pod.health === "healthy" ? "text-success" : pod.health === "critical" ? "text-danger" : pod.health === "warning" ? "text-warning" : "text-muted"}`}>{pod.status}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted">
        <span>{pod.ready} ready</span>
        {pod.restarts > 0 ? <span className="text-warning">{pod.restarts} restart{pod.restarts === 1 ? "" : "s"}</span> : null}
        {!pod.inService ? <span className="text-danger">not in service</span> : null}
        {pod.podIp ? <span className="ml-auto truncate font-mono">{pod.podIp}</span> : null}
      </div>
      <div className="mt-0.5 flex items-center gap-2 truncate text-[10.5px] text-muted">
        <span className="truncate" title={pod.nodeName}>{pod.nodeName ?? "not scheduled"}</span>
        {pod.cpu !== null ? <span className="ml-auto shrink-0 font-mono">{formatCpu(pod.cpu)} · {pod.memory !== null ? formatBytes(pod.memory) : "n/a"}</span> : null}
      </div>
    </div>
  );
}

function WorkloadCard({ node, lit, selected }: { node: PlacedNode; lit: Set<string> | null; selected: string | null }) {
  const pods = node.pods ?? [];
  const isSelected = selected === node.id;
  return (
    <div className={`h-full rounded-2xl border bg-surface-2/60 ${BORDER[node.health]} ${isSelected ? "ring-2 ring-accent" : ""}`} style={{ padding: WORKLOAD_PADDING }}>
      <div style={{ height: workloadHeaderHeight(node) }}>
        <Header node={node} />
        <Facts node={node} />
      </div>
      <div className="flex flex-col" style={{ gap: POD_ROW_GAP }}>
        {pods.length === 0 ? (
          <div style={{ height: POD_ROW_HEIGHT }} className="grid place-items-center rounded-lg border border-dashed border-border text-[11px] text-muted">No pods running</div>
        ) : (
          pods.map((p) => <PodRowCard key={p.id} pod={p} workload={node.title} lit={lit} selected={selected === p.id} />)
        )}
      </div>
    </div>
  );
}

export function Card({ data }: NodeProps<CardNode>) {
  const { node, lit, selected } = data;
  const dim = lit !== null && !lit.has(node.id);
  const isSelected = selected === node.id;
  return (
    <div
      data-node-id={node.id}
      style={{ width: node.width, height: node.height }}
      className={`transition-opacity ${dim ? "opacity-30" : ""}`}
    >
      <Anchors />
      {node.kind === "workload" ? (
        <WorkloadCard node={node} lit={lit} selected={selected} />
      ) : (
        <div
          className={`h-full rounded-xl border bg-surface px-3 py-2.5 shadow-sm ${node.missing ? "border-dashed border-danger/70" : BORDER[node.health]} ${isSelected ? "ring-2 ring-accent" : ""}`}
        >
          <Header node={node} />
          <Facts node={node} />
        </div>
      )}
    </div>
  );
}
