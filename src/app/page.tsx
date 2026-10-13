import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NamespaceExplorer } from "@/components/cluster/namespace-explorer";
import { NodeCard } from "@/components/cluster/node-card";
import { NodePoolsSection } from "@/components/cluster/node-pools";
import { ClusterError } from "@/components/layout/cluster-error";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { loadCluster } from "@/lib/data";
import { PROVIDER_LABEL } from "@/lib/providers/detect";
import { formatAge, formatBytes, formatCpu, formatPercent } from "@/lib/format";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const data = await loadCluster();
  if (!data.ok) return <ClusterError connection={data.connection} error={data.error} />;
  const { connection, nodes, namespaces, rows, nodePools, warnings } = data;
  const autoscaleMax = nodePools.state === "ok" ? nodePools.pools.filter((p) => p.autoScale).reduce((sum, p) => sum + (p.maxNodes ?? 0), 0) : 0;

  const sum = (pick: (n: (typeof nodes)[number]) => number) => nodes.reduce((a, n) => a + pick(n), 0);
  const cpuAlloc = sum((n) => n.cpu.allocatable);
  const cpuReq = sum((n) => n.cpu.requests);
  const memAlloc = sum((n) => n.memory.allocatable);
  const memReq = sum((n) => n.memory.requests);
  const running = rows.filter((r) => r.phase === "Running").length;
  const attention = rows.filter((r) => r.health === "critical" || r.health === "warning");
  const restarts = rows.reduce((a, r) => a + r.restarts, 0);
  const storage = namespaces.reduce((a, n) => a + n.storageBytes, 0);
  const pvcCount = namespaces.reduce((a, n) => a + n.counts.pvcs, 0);
  const restartedPods = rows.filter((r) => r.restarts > 0).length;
  const readyNodes = nodes.filter((n) => n.ready).length;
  const withPods = namespaces.filter((n) => n.pods.total > 0).length;
  const certAttention = data.certificates.state === "ok" ? data.certificates.certificates.filter((c) => c.health === "critical" || c.health === "warning") : [];

  return (
    <div className="space-y-8">
      <PageHeader title="Cluster overview" subtitle="Everything running in the connected cluster, read live from the Kubernetes API." />

      {warnings.length ? (
        <Card className="border-warning/40">
          <CardBody className="space-y-1 text-sm text-warning">
            {warnings.map((w) => <p key={w}>{w}</p>)}
          </CardBody>
        </Card>
      ) : null}

      <section aria-label="Summary" className="@container">
        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4 @7xl:grid-cols-8">
        <StatCard label="Nodes" value={`${readyNodes}/${nodes.length}`} hint={(readyNodes === nodes.length ? "all ready" : `${nodes.length - readyNodes} not ready`) + (autoscaleMax ? ` · autoscale up to ${autoscaleMax}` : "")} tone={readyNodes < nodes.length ? "danger" : undefined} />
        <StatCard label="Namespaces" value={namespaces.length} hint={`${withPods} with pods · ${namespaces.length - withPods} empty`} />
        <StatCard label="Pods running" value={`${running}/${rows.length}`} hint={running === rows.length ? "all running" : `${rows.length - running} not running`} />
        <StatCard label="Need attention" value={attention.length} tone={attention.some((r) => r.health === "critical") ? "danger" : attention.length ? "warning" : "success"} hint={attention.length ? "see the list below" : "everything is healthy"} />
        <StatCard label="Restarts" value={restarts} hint={restartedPods ? `across ${restartedPods} ${restartedPods === 1 ? "pod" : "pods"}` : "no pod has restarted"} />
        <StatCard label="CPU requested" value={formatPercent(cpuReq, cpuAlloc)} meter={{ value: cpuReq, max: cpuAlloc }} hint={`${formatCpu(cpuReq)} of ${formatCpu(cpuAlloc)} cores`} />
        <StatCard label="Memory requested" value={formatPercent(memReq, memAlloc)} meter={{ value: memReq, max: memAlloc }} hint={`${formatBytes(memReq)} of ${formatBytes(memAlloc)}`} />
        <StatCard label="Volumes" value={formatBytes(storage)} hint={`${pvcCount} ${pvcCount === 1 ? "claim" : "claims"}`} />
        </div>
      </section>

      <Card>
        <CardHeader
          title="Connection"
          subtitle="Read from your local kubeconfig. Credentials are never displayed."
          action={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Badge tone="success">Connected</Badge>
              <Badge tone="info">Live · read-only</Badge>
              <Badge tone={connection.metricsAvailable ? "success" : "warning"}>{connection.metricsAvailable ? "Metrics available" : "No metrics"}</Badge>
            </div>
          }
        />
        <CardBody>
          <KeyValue
            columns={4}
            items={[
              { label: "Cluster", value: connection.clusterName, mono: true },
              { label: "Context", value: connection.contextName, mono: true },
              { label: "Kubernetes version", value: connection.version, mono: true },
              { label: "Platform", value: [connection.platform, connection.provider ? PROVIDER_LABEL[connection.provider] : undefined, connection.region].filter(Boolean).join(" · "), mono: true },
              { label: "API server", value: connection.server, mono: true, wide: true },
              { label: "User", value: connection.userName, mono: true },
              { label: "Data source", value: "Live cluster (read-only)" },
            ]}
          />
        </CardBody>
      </Card>

      {certAttention.length ? (
        <Link href="/certificates" className="block">
          <Card className={`transition-colors hover:bg-surface-2 ${certAttention.some((c) => c.health === "critical") ? "border-danger/40" : "border-warning/40"}`}>
            <CardBody className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{certAttention.length} TLS certificate{certAttention.length === 1 ? " needs" : "s need"} attention</span>
              <span className="text-xs text-muted">{certAttention.map((c) => `${c.name}: ${c.problem}`).join(" · ")}</span>
              <ArrowRight className="ml-auto size-4 text-muted" />
            </CardBody>
          </Card>
        </Link>
      ) : null}

      {attention.length ? (
        <section aria-labelledby="attention">
          <h2 id="attention" className="mb-3 text-sm font-semibold">Pods that need attention</h2>
          <Card>
            <ul className="divide-y divide-border">
              {attention.slice(0, 10).map((r) => (
                <li key={`${r.namespace}/${r.name}`}>
                  <Link href={`/namespaces/${encodeURIComponent(r.namespace)}/pods/${encodeURIComponent(r.name)}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-surface-2">
                    <StatusBadge status={r.status} health={r.health} />
                    <span className="font-mono text-xs font-medium">{r.name}</span>
                    <span className="font-mono text-xs text-muted">{r.namespace}</span>
                    <span className="ml-auto flex items-center gap-3 text-xs text-muted">
                      {r.restarts ? <span>{r.restarts} restarts</span> : null}
                      <span>{formatAge(r.createdAt)}</span>
                      <ArrowRight className="size-3.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {attention.length > 10 ? <p className="border-t border-border px-4 py-2 text-xs text-muted">and {attention.length - 10} more. Open a namespace and use the “Needs attention” filter.</p> : null}
          </Card>
        </section>
      ) : null}

      <NodePoolsSection result={nodePools} nodes={nodes} />

      <section aria-labelledby="nodes">
        <h2 id="nodes" className="mb-3 text-sm font-semibold">Nodes</h2>
        <div className={`grid gap-3 ${nodes.length > 1 ? "xl:grid-cols-2" : ""}`}>
          {nodes.map((n) => <NodeCard key={n.name} node={n} pool={nodePools.state === "ok" ? nodePools.pools.find((p) => p.name === n.nodePool) : undefined} />)}
        </div>
      </section>

      <section aria-labelledby="namespaces">
        <h2 id="namespaces" className="mb-3 text-sm font-semibold">Namespaces</h2>
        <NamespaceExplorer namespaces={namespaces} />
      </section>
    </div>
  );
}
