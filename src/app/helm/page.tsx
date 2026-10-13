import { Info } from "lucide-react";
import { HelmTable } from "@/components/cluster/helm-table";
import { ClusterError } from "@/components/layout/cluster-error";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { loadCluster } from "@/lib/data";
import { formatAge } from "@/lib/format";

export const metadata = { title: "Helm releases" };

export default async function HelmPage() {
  const data = await loadCluster();
  if (!data.ok) return <ClusterError connection={data.connection} error={data.error} />;
  const { releases, revisions, message } = data.helm;
  const rows = releases.map((r) => ({ ...r, updated: r.updatedAt ? formatAge(r.updatedAt) : "—" }));

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: "Overview", href: "/" }, { label: "Helm releases" }]}
        title="Helm releases"
        subtitle="Like `helm list -A`: every release in the cluster, its revision, status and what it deployed."
      />
      {revisions === "unavailable" ? (
        <Card className="border-warning/40">
          <CardBody className="flex items-start gap-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium text-warning">Revision and status are not shown</p>
              <p className="mt-1 text-xs text-muted">{message} Releases below are found from the workloads Helm created.</p>
            </div>
          </CardBody>
        </Card>
      ) : null}
      <HelmTable releases={rows} />
    </div>
  );
}
