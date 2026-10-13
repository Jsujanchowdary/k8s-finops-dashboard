import Link from "next/link";
import { notFound } from "next/navigation";
import { HelmStatusBadge } from "@/components/cluster/helm-parts";
import { PodsTable } from "@/components/cluster/pods-table";
import { WorkloadsTable } from "@/components/cluster/tables";
import { ClusterError } from "@/components/layout/cluster-error";
import { HealthDot } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { loadCluster } from "@/lib/data";
import { formatAge } from "@/lib/format";
import { withAge } from "@/lib/k8s/table";

export async function generateMetadata(props: PageProps<"/helm/[ns]/[name]">) {
  const { name } = await props.params;
  return { title: `${decodeURIComponent(name)} · Helm` };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs uppercase tracking-wide text-muted/80">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

export default async function HelmReleasePage(props: PageProps<"/helm/[ns]/[name]">) {
  const params = await props.params;
  const ns = decodeURIComponent(params.ns);
  const name = decodeURIComponent(params.name);
  const data = await loadCluster();
  if (!data.ok) return <ClusterError connection={data.connection} error={data.error} />;
  const release = data.helm.releases.find((r) => r.namespace === ns && r.name === name);
  if (!release) notFound();

  const workloadNames = new Set(release.workloads.map((w) => w.name));
  const pods = data.rows.filter((r) => r.namespace === ns && r.owner && workloadNames.has(r.owner.name));

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Overview", href: "/" }, { label: "Helm releases", href: "/helm" }, { label: name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <HealthDot health={release.health} className="size-2.5" />
            <span className="break-all font-mono text-lg">{name}</span>
            <CopyButton text={name} label="Copy release name" />
            <HelmStatusBadge status={release.status} />
          </span>
        }
        subtitle={
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Fact label="Namespace"><Link href={`/namespaces/${encodeURIComponent(ns)}`} className="font-mono text-xs hover:text-accent">{ns}</Link></Fact>
            <Fact label="Revision">{release.revision !== undefined ? `#${release.revision}` : "—"}</Fact>
            <Fact label="Updated"><span title={release.updatedAt}>{release.updatedAt ? `${formatAge(release.updatedAt)} ago` : "—"}</span></Fact>
            <Fact label="Workloads">{release.workloads.length}</Fact>
            <Fact label="Pods">{release.pods.ready}/{release.pods.total} ready</Fact>
            {release.commits.length ? <Fact label="Commit"><span className="font-mono text-xs">{release.commits.map((c) => c.slice(0, 7)).join(", ")}</span></Fact> : null}
          </dl>
        }
      />

      <Card>
        <CardHeader title="Revision history" subtitle="Each deploy adds a revision. Helm keeps only a limited number (10 by default, or whatever --history-max your deploy sets), and `helm rollback` can only go back to one of these." />
        {release.revisions.length ? (
          <TableWrap>
            <Table>
              <thead><tr><Th>Revision</Th><Th>Status</Th><Th>Updated</Th><Th></Th></tr></thead>
              <tbody>
                {release.revisions.map((rev, i) => (
                  <tr key={rev.revision}>
                    <Td className="tabular-nums">#{rev.revision}</Td>
                    <Td><HelmStatusBadge status={rev.status} /></Td>
                    <Td className="tabular-nums text-muted"><span title={rev.updatedAt}>{rev.updatedAt ? `${formatAge(rev.updatedAt)} ago` : "—"}</span></Td>
                    <Td className="text-xs text-muted">{i === 0 ? "current" : ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <CardBody className="text-sm text-muted">Revision history is not available. {data.helm.message}</CardBody>
        )}
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Workloads</h2>
        <WorkloadsTable workloads={release.workloads} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Pods ({pods.length})</h2>
        <PodsTable rows={withAge(pods)} showNode metricsAvailable={data.connection.metricsAvailable} />
      </section>
    </div>
  );
}
