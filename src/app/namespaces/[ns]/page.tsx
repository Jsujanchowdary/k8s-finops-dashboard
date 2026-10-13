import { notFound } from "next/navigation";
import { Architecture } from "@/components/architecture/architecture";
import { NamespaceAccessView } from "@/components/cluster/access";
import { PodsTable } from "@/components/cluster/pods-table";
import { EventsTable, IngressTable, PvcTable, ServicesTable, WorkloadsTable } from "@/components/cluster/tables";
import { ClusterError } from "@/components/layout/cluster-error";
import { Badge, healthTone } from "@/components/ui/badge";
import { PageHeader, TabLinks } from "@/components/ui/misc";
import { StatCard } from "@/components/ui/card";
import { loadCluster } from "@/lib/data";
import { formatAge, formatBytes, formatCpu } from "@/lib/format";
import { namespaceAccess } from "@/lib/k8s/access";
import { withAge } from "@/lib/k8s/table";
import { buildTopology } from "@/lib/topology/build";
import { layoutTopology } from "@/lib/topology/layout";
import { buildEventViews, buildIngressViews, buildPvcViews, buildServiceViews, buildWorkloads } from "@/lib/k8s/views";

export async function generateMetadata(props: PageProps<"/namespaces/[ns]">) {
  const { ns } = await props.params;
  return { title: decodeURIComponent(ns) };
}

export default async function NamespacePage(props: PageProps<"/namespaces/[ns]">) {
  const { ns: rawNs } = await props.params;
  const ns = decodeURIComponent(rawNs);
  const sp = await props.searchParams;
  const data = await loadCluster();
  if (!data.ok) return <ClusterError connection={data.connection} error={data.error} />;

  const view = data.namespaces.find((n) => n.name === ns);
  if (!view) notFound();

  const rows = data.rows.filter((r) => r.namespace === ns);
  const workloads = buildWorkloads(data.bundle, ns);
  const services = buildServiceViews(data.bundle, ns);
  const ingresses = buildIngressViews(data.bundle, ns);
  const pvcs = buildPvcViews(data.bundle, ns);
  const events = buildEventViews(data.bundle.events, (e) => (e.metadata?.namespace ?? e.involvedObject?.namespace) === ns);

  const tabs = [
    { id: "pods", label: "Pods", count: rows.length },
    { id: "architecture", label: "Architecture" },
    { id: "workloads", label: "Workloads", count: workloads.length },
    { id: "network", label: "Network", count: services.length + ingresses.length },
    { id: "storage", label: "Storage", count: pvcs.length },
    { id: "events", label: "Events", count: events.length },
    ...(data.access.state === "ok" ? [{ id: "access", label: "Access" }] : []),
  ];
  const requested = typeof sp.tab === "string" ? sp.tab : "pods";
  const tab = tabs.some((t) => t.id === requested) ? requested : "pods";
  const base = `/namespaces/${encodeURIComponent(ns)}`;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Overview", href: "/" }, { label: "Namespaces" }, { label: ns }]}
        title={<span className="flex items-center gap-3"><span className="font-mono">{ns}</span><Badge tone={healthTone(view.health)}>{view.health === "unknown" ? "empty" : view.health}</Badge></span>}
        subtitle={`${view.phase} · created ${formatAge(view.createdAt)} ago${view.hosts.length ? ` · ${view.hosts.join(", ")}` : ""}`}
      />

      <section aria-label="Namespace summary" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Pods running" value={`${view.pods.running}/${view.pods.total}`} hint={view.pods.succeeded ? `${view.pods.succeeded} completed` : undefined} />
        <StatCard label="Need attention" value={view.pods.unhealthy} tone={view.pods.unhealthy ? (view.health === "critical" ? "danger" : "warning") : "success"} />
        <StatCard label="Restarts" value={view.restarts} />
        <StatCard label="CPU" value={view.cpu.usage === null ? "n/a" : formatCpu(view.cpu.usage)} hint={view.cpu.request ? `${formatCpu(view.cpu.request)} requested` : "no pod requests CPU"} />
        <StatCard label="Memory" value={view.memory.usage === null ? "n/a" : formatBytes(view.memory.usage)} hint={view.memory.request ? `${formatBytes(view.memory.request)} requested` : "no pod requests memory"} />
        <StatCard label="Volumes" value={formatBytes(view.storageBytes)} hint={`${view.counts.pvcs} claims`} />
      </section>

      <TabLinks tabs={tabs} active={tab} base={base} />

      {tab === "pods" ? <PodsTable rows={withAge(rows)} metricsAvailable={data.connection.metricsAvailable} /> : null}
      {tab === "architecture" ? <Architecture topology={layoutTopology(buildTopology(data.bundle, data.rows, ns))} /> : null}
      {tab === "workloads" ? <WorkloadsTable workloads={workloads} /> : null}
      {tab === "network" ? (
        <div className="space-y-6">
          <div><h2 className="mb-2 text-sm font-semibold">Services</h2><ServicesTable services={services} namespace={ns} /></div>
          <div><h2 className="mb-2 text-sm font-semibold">Ingresses</h2><IngressTable ingresses={ingresses} /></div>
        </div>
      ) : null}
      {tab === "storage" ? <PvcTable pvcs={pvcs} /> : null}
      {tab === "events" ? <EventsTable events={events} /> : null}
      {tab === "access" && data.access.state === "ok" ? <NamespaceAccessView ns={ns} view={namespaceAccess(data.access.report, ns, data.bundle.pods)} /> : null}
    </div>
  );
}
