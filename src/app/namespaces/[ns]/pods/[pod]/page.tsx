import Link from "next/link";
import { notFound } from "next/navigation";
import { PodLogs } from "@/components/cluster/pod-logs";
import { PodContainers, PodNetwork, PodOverview, PodRaw, PodResources, PodScheduling, PodStorage } from "@/components/cluster/pod-sections";
import { EventsTable } from "@/components/cluster/tables";
import { ClusterError } from "@/components/layout/cluster-error";
import { StatusBadge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { PageHeader, TabLinks } from "@/components/ui/misc";
import { logsEnabled } from "@/lib/config";
import { getPodDetail, loadCluster } from "@/lib/data";
import { formatAge } from "@/lib/format";

function Fact({ label, children, warn = false }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs uppercase tracking-wide text-muted/80">{label}</dt>
      <dd className={warn ? "font-medium text-warning" : "text-text"}>{children}</dd>
    </div>
  );
}

export async function generateMetadata(props: PageProps<"/namespaces/[ns]/pods/[pod]">) {
  const { pod } = await props.params;
  return { title: decodeURIComponent(pod) };
}

export default async function PodPage(props: PageProps<"/namespaces/[ns]/pods/[pod]">) {
  const params = await props.params;
  const ns = decodeURIComponent(params.ns);
  const name = decodeURIComponent(params.pod);
  const sp = await props.searchParams;

  const cluster = await loadCluster();
  if (!cluster.ok) return <ClusterError connection={cluster.connection} error={cluster.error} />;
  const detail = await getPodDetail(ns, name);
  if (!detail) notFound();

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "containers", label: "Containers", count: detail.containers.length },
    { id: "resources", label: "Resources" },
    { id: "network", label: "Network", count: detail.network.services.length },
    { id: "storage", label: "Storage & config", count: detail.volumes.length },
    { id: "scheduling", label: "Scheduling" },
    { id: "events", label: "Events", count: detail.events.length },
    { id: "logs", label: "Logs" },
    { id: "yaml", label: "YAML" },
  ];
  const requested = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab = tabs.some((t) => t.id === requested) ? requested : "overview";
  const base = `/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`;
  const r = detail.row;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Overview", href: "/" }, { label: ns, href: `/namespaces/${encodeURIComponent(ns)}` }, { label: name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="break-all font-mono text-lg">{name}</span>
            <CopyButton text={name} label="Copy pod name" />
            <StatusBadge status={r.status} health={r.health} />
          </span>
        }
        subtitle={
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Fact label="Ready">{r.ready}</Fact>
            <Fact label="Restarts" warn={r.restarts >= 5}>{r.restarts}</Fact>
            <Fact label="Node">
              {r.nodeName ? <Link href={`/nodes/${encodeURIComponent(r.nodeName)}`} className="font-mono text-xs hover:text-accent">{r.nodeName}</Link> : <span className="text-muted">not scheduled</span>}
            </Fact>
            <Fact label="Pod IP"><span className="font-mono text-xs">{r.podIp ?? "none yet"}</span></Fact>
            {r.commit ? <Fact label="Commit"><span className="font-mono text-xs" title={r.commit}>{r.commit.slice(0, 7)}</span></Fact> : null}
            <Fact label="Age"><span title={r.createdAt}>{formatAge(r.createdAt)}</span></Fact>
          </dl>
        }
      />
      <TabLinks tabs={tabs} active={tab} base={base} />
      {tab === "overview" ? <PodOverview d={detail} /> : null}
      {tab === "containers" ? <PodContainers d={detail} /> : null}
      {tab === "resources" ? <PodResources d={detail} metricsAvailable={cluster.connection.metricsAvailable} /> : null}
      {tab === "network" ? <PodNetwork d={detail} namespace={ns} /> : null}
      {tab === "storage" ? <PodStorage d={detail} /> : null}
      {tab === "scheduling" ? <PodScheduling d={detail} /> : null}
      {tab === "events" ? <EventsTable events={detail.events} showObject={false} /> : null}
      {tab === "logs" ? (
        <PodLogs
          namespace={ns}
          pod={name}
          enabled={logsEnabled()}
          containers={detail.containers.map((c) => ({ name: c.name, isInit: c.isInit, state: c.state.kind, restarts: c.restartCount }))}
        />
      ) : null}
      {tab === "yaml" ? <PodRaw d={detail} /> : null}
    </div>
  );
}
