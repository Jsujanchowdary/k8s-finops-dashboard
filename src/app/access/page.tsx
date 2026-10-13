import { CapabilityLegend, NoAccessCard, SubjectList } from "@/components/cluster/access";
import { ClusterError } from "@/components/layout/cluster-error";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { loadCluster } from "@/lib/data";

export const metadata = { title: "Access" };

export default async function AccessPage() {
  const data = await loadCluster();
  if (!data.ok) return <ClusterError connection={data.connection} error={data.error} />;
  const header = (
    <PageHeader
      crumbs={[{ label: "Overview", href: "/" }, { label: "Access" }]}
      title="Access"
      subtitle="Who and what can act on the cluster, from its RBAC roles and bindings: people through their DigitalOcean team role, and the ServiceAccounts apps and operators run as. Read-only; Secret values are never read, only who may read them."
    />
  );
  if (data.access.state === "error") {
    return <div className="space-y-4">{header}<Card className="border-warning/40"><CardBody className="text-sm text-warning">Roles and bindings could not be read: {data.access.message}</CardBody></Card></div>;
  }

  const { subjects, noAccess } = data.access.report;
  const people = subjects.filter((s) => s.category === "people");
  const apps = subjects.filter((s) => s.category === "apps");
  const system = subjects.filter((s) => s.category === "system");
  const admins = people.filter((s) => s.capabilities.some((c) => c.id === "admin"));
  const secretReaders = [...people, ...apps].filter((s) => s.capabilities.some((c) => c.id === "secrets-read" || c.id === "admin"));
  const appsWithAccess = apps.filter((s) => s.severity !== null);
  const appsCritical = apps.filter((s) => s.severity === "critical");

  return (
    <div className="space-y-6">
      {header}

      <section aria-label="Summary" className="@container">
        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-5">
          <StatCard label="Full admins" value={admins.length} hint={admins.map((a) => a.label.replace("DigitalOcean team role: ", "")).join(", ").replace("DigitalOcean-issued kubeconfig (doctl / control panel download)", "DO kubeconfig") || "none"} />
          <StatCard label="Can read Secrets" value={secretReaders.length} hint="people and apps, cluster-wide or in a namespace" />
          <StatCard label="Apps with API access" value={appsWithAccess.length} tone={appsCritical.length ? "danger" : undefined} hint={appsCritical.length ? `${appsCritical.length} can take over the cluster` : "none can take over the cluster"} />
          <StatCard label="Apps with no API access" value={noAccess.length} tone="success" hint="cannot touch the cluster: the safe default" />
          <StatCard label="System accounts" value={system.length} hint="Kubernetes and DigitalOcean, listed separately" />
        </div>
      </section>

      <Card>
        <CardHeader title="People" subtitle="Access comes from the role each person has in your DigitalOcean team, and from kubeconfigs DigitalOcean issues. Manage it in the DigitalOcean control panel (Settings → Team), not in Kubernetes." />
        {people.length ? <SubjectList subjects={people} showUsage={false} /> : <CardBody className="text-sm text-muted">No people bindings found.</CardBody>}
      </Card>

      <Card>
        <CardHeader title="Apps and operators" subtitle="ServiceAccounts that have permissions, most powerful first, with the workloads that run as each. Operators need broad access to do their job; an ordinary app should need none." />
        {apps.length ? <SubjectList subjects={apps} showUsage /> : <CardBody className="text-sm text-muted">No app or operator has any permission.</CardBody>}
      </Card>

      <NoAccessCard accounts={noAccess} />

      {system.length ? (
        <Card>
          <details className="group">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <span className="font-medium">{system.length} system accounts and groups</span>
              <span className="ml-2 text-xs text-muted">Kubernetes and DigitalOcean components (networking, storage, autoscaler, nodes). Broad access by design and managed by DigitalOcean. Show</span>
            </summary>
            <SubjectList subjects={system} showUsage />
          </details>
        </Card>
      ) : null}

      <CapabilityLegend />
    </div>
  );
}
