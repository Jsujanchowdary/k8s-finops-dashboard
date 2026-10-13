import { Info } from "lucide-react";
import { AttentionList, CertificatesTable, ChallengesCard, IssuersCard } from "@/components/cluster/certificates";
import { ClusterError } from "@/components/layout/cluster-error";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { loadCluster } from "@/lib/data";
import { formatDay, relativeDays } from "@/lib/format";

export const metadata = { title: "Certificates" };

export default async function CertificatesPage() {
  const data = await loadCluster();
  if (!data.ok) return <ClusterError connection={data.connection} error={data.error} />;
  const header = (
    <PageHeader
      crumbs={[{ label: "Overview", href: "/" }, { label: "Certificates" }]}
      title="Certificates"
      subtitle="The TLS certificates cert-manager issues and renews for your sites: what they cover, who signs them, and when they expire. Read from cert-manager; certificate contents and private keys are never read."
    />
  );

  const certs = data.certificates;
  if (certs.state === "not-installed") {
    return <div className="space-y-4">{header}<Card><CardBody className="text-sm text-muted">cert-manager is not installed in this cluster, so there are no managed certificates to show.</CardBody></Card></div>;
  }
  if (certs.state === "error") {
    return (
      <div className="space-y-4">
        {header}
        <Card className="border-warning/40"><CardBody className="text-sm text-warning">Certificates could not be read: {certs.message}</CardBody></Card>
      </div>
    );
  }

  const now = Date.parse(data.connection.fetchedAt);
  const { certificates, issuers, challenges } = certs;
  const attention = certificates.filter((c) => c.health === "critical" || c.health === "warning");
  const issued = certificates.filter((c) => c.notAfter);
  const nextRenewal = issued.filter((c) => c.renewalTime && c.state !== "renewal-overdue").sort((a, b) => a.renewalTime!.localeCompare(b.renewalTime!))[0];
  const nextExpiry = [...issued].sort((a, b) => a.notAfter!.localeCompare(b.notAfter!))[0];
  const readyIssuers = issuers.filter((i) => i.ready).length;
  const letsEncrypt = certificates.filter((c) => issuers.some((i) => i.name === c.issuer.name && i.kind === c.issuer.kind && i.type.startsWith("Let's Encrypt"))).length;

  return (
    <div className="space-y-6">
      {header}

      <section aria-label="Summary" className="@container">
        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-5">
          <StatCard label="Certificates" value={certificates.length} hint={letsEncrypt ? `${letsEncrypt} from Let's Encrypt` : undefined} />
          <StatCard label="Need attention" value={attention.length} tone={attention.some((c) => c.health === "critical") ? "danger" : attention.length ? "warning" : "success"} hint={attention.length ? "see the list below" : "all valid and renewing on time"} />
          <StatCard label="Next renewal" value={nextRenewal ? relativeDays(nextRenewal.daysToRenewal) : "—"} hint={nextRenewal ? `${nextRenewal.name} · ${formatDay(nextRenewal.renewalTime)}` : undefined} />
          <StatCard label="Next expiry" value={nextExpiry ? relativeDays(nextExpiry.daysLeft) : "—"} tone={nextExpiry?.health === "critical" ? "danger" : nextExpiry?.health === "warning" ? "warning" : undefined} hint={nextExpiry ? `${nextExpiry.name} · ${formatDay(nextExpiry.notAfter)}` : undefined} />
          <StatCard label="Issuers ready" value={`${readyIssuers}/${issuers.length}`} tone={readyIssuers < issuers.length ? "danger" : undefined} hint={issuers.map((i) => i.name).join(", ") || "none configured"} />
        </div>
      </section>

      <AttentionList certificates={certificates} />

      <Card>
        <CardHeader title="All certificates" subtitle="Most urgent first. The bar is each certificate's lifetime so far; the white tick is when cert-manager renews it." />
        {certificates.length ? <CertificatesTable certificates={certificates} now={now} /> : <EmptyState title="No certificates" hint="cert-manager is installed but manages no certificates yet." />}
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <IssuersCard issuers={issuers} />
        <ChallengesCard challenges={challenges} />
      </div>

      <Card>
        <CardBody className="flex items-start gap-3 text-xs text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p>cert-manager renews a certificate on its own at the renewal time: by default two thirds of the way through its life, which is 30 days before expiry for Let&apos;s Encrypt&apos;s 90-day certificates. Nothing needs doing while every certificate is valid and the renewal dates are in the future.</p>
            <p>Flagged here: not ready, expired or expiring within 7 days (critical); expiring within 14 days, or renewal time passed more than a day ago without a new certificate (warning).</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
