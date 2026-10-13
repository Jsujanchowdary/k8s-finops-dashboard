import Link from "next/link";
import { Badge, HealthDot, StatusBadge, healthTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import type { CertificateState, CertificateView, ChallengeView, IssuerView } from "@/lib/k8s/certificates";
import { formatDay, relativeDays } from "@/lib/format";

const STATE_LABEL: Record<CertificateState, string> = {
  valid: "Valid",
  expiring: "Expiring soon",
  "renewal-overdue": "Renewal overdue",
  expired: "Expired",
  "not-ready": "Not ready",
  pending: "Not issued yet",
};

const nsHref = (ns: string) => `/namespaces/${encodeURIComponent(ns)}`;

/**
 * Where the certificate is in its life: filled from issue to now, a tick at the renewal time, the end is expiry.
 * The fill takes the certificate's health colour, so an expiring one reads red at a glance.
 */
export function Lifetime({ cert, now }: { cert: CertificateView; now: number }) {
  if (!cert.notBefore || !cert.notAfter) return <span className="text-xs text-muted">not issued</span>;
  const start = Date.parse(cert.notBefore);
  const end = Date.parse(cert.notAfter);
  const span = Math.max(1, end - start);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const used = pct(now);
  const renew = cert.renewalTime ? pct(Date.parse(cert.renewalTime)) : null;
  const fill = cert.health === "critical" ? "bg-danger" : cert.health === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div className="w-32">
      <div
        role="img"
        aria-label={`${Math.round(used)}% of its lifetime used${renew !== null ? `, renews at ${Math.round(renew)}%` : ""}`}
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${Math.max(used, 1.5)}%` }} />
        {renew !== null ? <div title={`renews ${formatDay(cert.renewalTime)}`} className="absolute inset-y-0 w-0.5 bg-text/70" style={{ left: `clamp(0px, calc(${renew}% - 1px), calc(100% - 2px))` }} /> : null}
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-muted">{formatDay(cert.notBefore)} → {formatDay(cert.notAfter)}</p>
    </div>
  );
}

export function CertificatesTable({ certificates, now }: { certificates: CertificateView[]; now: number }) {
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>Certificate</Th>
            <Th>Hosts</Th>
            <Th>Issuer</Th>
            <Th>Status</Th>
            <Th>Lifetime</Th>
            <Th>Expires</Th>
            <Th>Renews</Th>
            <Th>Served by</Th>
          </tr>
        </thead>
        <tbody>
          {certificates.map((c) => (
            <tr key={`${c.namespace}/${c.name}`}>
              <Td>
                <p className="font-mono text-xs font-medium">{c.name}</p>
                <Link href={nsHref(c.namespace)} className="font-mono text-[11px] text-muted hover:text-accent">{c.namespace}</Link>
              </Td>
              <Td wrap>
                <div className="flex flex-col gap-0.5 font-mono text-xs">
                  {c.dnsNames.slice(0, 3).map((h) => <span key={h} className="break-all">{h}</span>)}
                  {c.dnsNames.length > 3 ? <span className="text-muted">+{c.dnsNames.length - 3} more</span> : null}
                </div>
              </Td>
              <Td className="font-mono text-xs">
                {c.issuer.name}
                <span className="block text-[11px] text-muted">{c.issuer.kind}</span>
              </Td>
              <Td>
                <span title={c.problem ?? c.readyMessage}><StatusBadge status={STATE_LABEL[c.state]} health={c.health} /></span>
              </Td>
              <Td><Lifetime cert={c} now={now} /></Td>
              <Td className="tabular-nums">
                {formatDay(c.notAfter)}
                <span className={`block text-[11px] ${c.health === "critical" ? "text-danger" : c.health === "warning" ? "text-warning" : "text-muted"}`}>{relativeDays(c.daysLeft)}</span>
              </Td>
              <Td className="tabular-nums">
                {formatDay(c.renewalTime)}
                <span className={`block text-[11px] ${c.state === "renewal-overdue" ? "text-warning" : "text-muted"}`}>{c.state === "renewal-overdue" ? `due ${relativeDays(c.daysToRenewal)}` : relativeDays(c.daysToRenewal)}</span>
              </Td>
              <Td className="text-xs">
                {c.ingresses.length ? (
                  c.ingresses.map((i) => (
                    <Link key={i.name} href={`${nsHref(c.namespace)}?tab=network`} className="block font-mono hover:text-accent">ingress {i.name}</Link>
                  ))
                ) : (
                  <span className="text-muted" title="No Ingress in this namespace uses its Secret. It may be used by a webhook or another component.">{c.owner ?? "not an ingress"}</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export function AttentionList({ certificates }: { certificates: CertificateView[] }) {
  const bad = certificates.filter((c) => c.health === "critical" || c.health === "warning");
  if (!bad.length) return null;
  return (
    <Card className={bad.some((c) => c.health === "critical") ? "border-danger/40" : "border-warning/40"}>
      <CardHeader title={`${bad.length} certificate${bad.length === 1 ? " needs" : "s need"} attention`} />
      <ul className="divide-y divide-border">
        {bad.map((c) => (
          <li key={`${c.namespace}/${c.name}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <HealthDot health={c.health} className="mt-2" />
            <span className="font-mono text-xs font-medium">{c.namespace}/{c.name}</span>
            <span className="font-mono text-xs text-muted">{c.dnsNames[0] ?? ""}</span>
            <span className="basis-full pl-4 text-xs text-muted">{c.problem}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function IssuersCard({ issuers }: { issuers: IssuerView[] }) {
  return (
    <Card>
      <CardHeader title="Issuers" subtitle="Who signs the certificates. A ClusterIssuer serves every namespace; an Issuer only its own." />
      {issuers.length === 0 ? (
        <CardBody className="text-sm text-muted">No issuer is configured, so cert-manager cannot issue certificates.</CardBody>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Issuer</Th><Th>Type</Th><Th>Status</Th><Th className="text-right">Certificates</Th></tr></thead>
            <tbody>
              {issuers.map((i) => (
                <tr key={`${i.kind}/${i.namespace ?? ""}/${i.name}`}>
                  <Td>
                    <p className="font-mono text-xs font-medium">{i.name}</p>
                    <p className="text-[11px] text-muted">{i.kind}{i.namespace ? <> · <Link href={nsHref(i.namespace)} className="font-mono hover:text-accent">{i.namespace}</Link></> : null}</p>
                  </Td>
                  <Td className="text-xs">{i.type}{i.solvers.length ? <span className="block text-[11px] text-muted">{i.solvers.join(", ")} challenge</span> : null}</Td>
                  <Td><span title={i.message}><Badge tone={healthTone(i.health)}>{i.ready ? "Ready" : i.reason ?? "Not ready"}</Badge></span></Td>
                  <Td className="text-right tabular-nums">{i.certificates}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

export function ChallengesCard({ challenges }: { challenges: ChallengeView[] }) {
  return (
    <Card>
      <CardHeader title="Challenges in progress" subtitle="Let's Encrypt asks cert-manager to prove it controls each host before it issues. A stuck challenge is why a certificate does not arrive." />
      {challenges.length === 0 ? (
        <CardBody className="text-sm text-muted">None. No certificate is being issued or renewed right now.</CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {challenges.map((ch) => (
            <li key={`${ch.namespace}/${ch.name}`} className="space-y-1 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={ch.state === "valid" ? "success" : ch.state === "invalid" || ch.state === "errored" ? "danger" : "warning"}>{ch.state}</Badge>
                <span className="font-mono text-xs font-medium">{ch.dnsName}</span>
                <span className="text-xs text-muted">{ch.type} · {ch.namespace}</span>
              </div>
              {ch.reason ? <p className="break-words text-xs text-muted">{ch.reason}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
