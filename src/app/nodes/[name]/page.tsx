import { notFound } from "next/navigation";
import { NodeCard } from "@/components/cluster/node-card";
import { PodsTable } from "@/components/cluster/pods-table";
import { ClusterError } from "@/components/layout/cluster-error";
import { Badge, healthTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip, KeyValue, PageHeader } from "@/components/ui/misc";
import { loadCluster } from "@/lib/data";
import { formatAge } from "@/lib/format";
import { withAge } from "@/lib/k8s/table";

export async function generateMetadata(props: PageProps<"/nodes/[name]">) {
  const { name } = await props.params;
  return { title: decodeURIComponent(name) };
}

export default async function NodePage(props: PageProps<"/nodes/[name]">) {
  const name = decodeURIComponent((await props.params).name);
  const data = await loadCluster();
  if (!data.ok) return <ClusterError connection={data.connection} error={data.error} />;
  const node = data.nodes.find((n) => n.name === name);
  if (!node) notFound();
  const rows = data.rows.filter((r) => r.nodeName === name);

  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Overview", href: "/" }, { label: "Nodes" }, { label: name }]} title={<span className="font-mono">{name}</span>} subtitle={`${node.status} · up ${formatAge(node.createdAt)}`} />
      <NodeCard node={node} />
      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <KeyValue
            columns={3}
            items={[
              { label: "Instance type", value: node.instanceType, mono: true },
              { label: "Node pool", value: node.nodePool, mono: true },
              { label: "Region / zone", value: [node.region, node.zone].filter(Boolean).join(" / "), mono: true },
              { label: "Provider ID", value: node.providerId, mono: true },
              { label: "Internal IP", value: node.internalIp, mono: true },
              { label: "External IP", value: node.externalIp, mono: true },
              { label: "Kubelet", value: node.kubeletVersion, mono: true },
              { label: "OS", value: node.osImage },
              { label: "Kernel", value: node.kernelVersion, mono: true },
              { label: "Container runtime", value: node.containerRuntime, mono: true },
              { label: "Architecture", value: node.architecture, mono: true },
              { label: "Roles", value: node.roles.join(", ") || undefined },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Conditions" />
        <CardBody className="space-y-2">
          {node.conditions.map((c) => (
            <div key={c.type} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={healthTone(c.health)}>{c.type}: {c.status}</Badge>
              <span className="text-xs text-muted">{c.reason}{c.message ? ` · ${c.message}` : ""}</span>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Labels" />
        <CardBody className="flex flex-wrap gap-1.5">{Object.entries(node.labels).map(([k, v]) => <Chip key={k}>{k}={v}</Chip>)}</CardBody>
      </Card>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Pods on this node ({rows.length})</h2>
        <PodsTable rows={withAge(rows)} showNamespace showNode={false} metricsAvailable={data.connection.metricsAvailable} />
      </section>
    </div>
  );
}
