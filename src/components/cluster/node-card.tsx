import Link from "next/link";
import { Cpu, MapPin, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Chip } from "@/components/ui/misc";
import type { NodePoolView } from "@/lib/do/node-pools-core";
import { formatAge, formatBytes, formatCpu } from "@/lib/format";
import type { NodeView } from "@/lib/k8s/types";
import { ResourceLine } from "./resource-line";

export function NodeCard({ node, pool }: { node: NodeView; pool?: NodePoolView }) {
  const problems = node.conditions.filter((c) => c.health === "critical" || c.health === "warning");
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/nodes/${encodeURIComponent(node.name)}`} className="block truncate font-mono text-sm font-semibold hover:text-accent">{node.name}</Link>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {node.instanceType ? <span className="inline-flex items-center gap-1"><Cpu className="size-3" />{node.instanceType}</span> : null}
              {node.nodePool ? <span>· pool {node.nodePool}{pool ? (pool.autoScale ? ` (autoscale ${pool.minNodes}–${pool.maxNodes})` : " (fixed size)") : ""}</span> : null}
              {node.region ? <span className="inline-flex items-center gap-1">· <MapPin className="size-3" />{node.region}{node.zone ? `/${node.zone}` : ""}</span> : null}
            </div>
          </div>
          <Badge tone={node.ready && !node.unschedulable ? "success" : node.ready ? "warning" : "danger"}>{node.status}</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ResourceLine label="CPU" kind="cpu" usage={node.cpu.usage} request={node.cpu.requests} limit={node.cpu.limits} max={node.cpu.allocatable || node.cpu.capacity} maxLabel={`${formatCpu(node.cpu.allocatable)} allocatable`} />
          <ResourceLine label="Memory" kind="memory" usage={node.memory.usage} request={node.memory.requests} limit={node.memory.limits} max={node.memory.allocatable || node.memory.capacity} maxLabel={`${formatBytes(node.memory.allocatable)} allocatable`} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>Pods <span className="tabular-nums text-text">{node.pods.count}</span>/{node.pods.capacity}</span>
          <span className="inline-flex items-center gap-1"><Network className="size-3" />{node.internalIp ?? "—"}{node.externalIp ? ` · ${node.externalIp}` : ""}</span>
          <span>{node.kubeletVersion}</span>
          <span>{node.osImage}</span>
          <span>up {formatAge(node.createdAt)}</span>
        </div>

        {problems.length ? (
          <div className="flex flex-wrap gap-1.5">
            {problems.map((p) => <Badge key={p.type} tone="danger" title={p.message}>{p.type}: {p.reason ?? p.status}</Badge>)}
          </div>
        ) : null}
        {node.taints.length ? <div className="flex flex-wrap gap-1.5">{node.taints.map((t) => <Chip key={t}>taint {t}</Chip>)}</div> : null}
      </CardBody>
    </Card>
  );
}
