import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { monthly, type Allocation, type MissingRequests, type PoolCeiling, type PricedThing } from "@/lib/finops/allocation";
import { usd } from "@/lib/finops/format";
import type { LineCost } from "@/lib/finops/spend";
import { formatBytes, formatCpu, formatPercent } from "@/lib/format";

export function Unavailable({ what, message }: { what: string; message: string }) {
  return (
    <Card className="border-warning/40">
      <CardBody className="flex items-start gap-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <p className="font-medium text-warning">{what} unavailable</p>
          <p className="mt-1 text-xs text-muted">{message}</p>
        </div>
      </CardBody>
    </Card>
  );
}

export function TokenHelp() {
  return (
    <Card>
      <CardBody className="flex items-start gap-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted" />
        <div className="space-y-1.5">
          <p className="font-medium">FinOps needs a DigitalOcean API token</p>
          <p className="text-xs text-muted">
            Billing lives in DigitalOcean, not Kubernetes. Create a token at cloud.digitalocean.com/account/api with custom read scopes{" "}
            <code className="font-mono text-text">billing:read</code>, <code className="font-mono text-text">sizes:read</code> and <code className="font-mono text-text">kubernetes:read</code>, then connect it in{" "}
            <Link href="/settings" className="text-accent hover:underline">Settings</Link>. It is checked, saved and used at once, and stays on this machine.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

export function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3">
      <div>
        <h2 id={`${id}-title`} className="text-sm font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

const nsHref = (ns: string) => `/namespaces/${encodeURIComponent(ns)}`;

export function UtilisationCard({ cpu, memory, idleMonthly }: { cpu: { allocatable: number; requests: number; usage: number | null }; memory: { allocatable: number; requests: number; usage: number | null }; idleMonthly: number | null }) {
  const row = (label: string, r: { allocatable: number; requests: number; usage: number | null }, fmt: (n: number) => string) => (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-xs tabular-nums text-muted">
          requested <span className="font-medium text-text">{formatPercent(r.requests, r.allocatable)}</span>
          {r.usage !== null ? <> · used <span className="font-medium text-text">{formatPercent(r.usage, r.allocatable)}</span></> : null} of {fmt(r.allocatable)}
        </span>
      </div>
      <Meter usage={r.usage} request={r.requests} max={r.allocatable} label={`${label} use`} colorize={false} />
    </div>
  );
  return (
    <Card>
      <CardHeader title="Cluster utilisation" subtitle="Bar: used now. Lighter band: requested. Both against what the nodes can give pods." />
      <CardBody className="space-y-4">
        {row("CPU", cpu, (n) => `${formatCpu(n)} cores`)}
        {row("Memory", memory, formatBytes)}
        {idleMonthly !== null ? <p className="text-xs text-muted">Capacity that no pod reserves or uses costs about <span className="font-medium text-text">{usd(idleMonthly)}</span> a month.</p> : null}
      </CardBody>
    </Card>
  );
}

export function UnusedRequestsCard({ allocation }: { allocation: Allocation }) {
  const rows = allocation.namespaces
    .map((n) => ({ ns: n.namespace, cpu: n.unusedCpu ?? 0, memory: n.unusedMemory ?? 0 }))
    .map((r) => ({ ...r, total: r.cpu + r.memory }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  return (
    <Card>
      <CardHeader title="Requested but not used" subtitle="max(0, request − usage) × rate: capacity reserved for pods that they do not use right now" />
      {!allocation.metricsAvailable ? (
        <CardBody className="text-sm text-muted">Needs metrics-server, which is not available, so usage is unknown.</CardBody>
      ) : rows.length === 0 ? (
        <CardBody className="text-sm text-muted">Every pod uses at least what it requests.</CardBody>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Namespace</Th><Th className="text-right">CPU / month</Th><Th className="text-right">Memory / month</Th><Th className="text-right">Total / month</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ns}>
                  <Td mono><Link href={nsHref(r.ns)} className="hover:text-accent">{r.ns}</Link></Td>
                  <Td className="text-right tabular-nums">{usd(monthly(r.cpu))}</Td>
                  <Td className="text-right tabular-nums">{usd(monthly(r.memory))}</Td>
                  <Td className="text-right tabular-nums font-medium">{usd(monthly(r.total))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

export function MissingRequestsCard({ pods }: { pods: MissingRequests[] }) {
  return (
    <Card>
      <CardHeader
        title="Pods without requests"
        subtitle="They are charged only for what they use now, and the scheduler can't plan for them"
        action={<Badge tone={pods.length ? "warning" : "success"}>{pods.length}</Badge>}
      />
      {pods.length === 0 ? (
        <CardBody className="text-sm text-muted">Every running pod requests CPU and memory.</CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {pods.slice(0, 10).map((p) => (
            <li key={`${p.namespace}/${p.pod}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <Link href={`${nsHref(p.namespace)}/pods/${encodeURIComponent(p.pod)}`} className="font-mono text-xs hover:text-accent">{p.pod}</Link>
              <span className="font-mono text-xs text-muted">{p.namespace}</span>
              <span className="ml-auto flex gap-1">{p.cpu ? <Badge tone="warning">no CPU request</Badge> : null}{p.memory ? <Badge tone="warning">no memory request</Badge> : null}</span>
            </li>
          ))}
          {pods.length > 10 ? <li className="px-4 py-2 text-xs text-muted">and {pods.length - 10} more</li> : null}
        </ul>
      )}
    </Card>
  );
}

export function CeilingCard({ pools }: { pools: PoolCeiling[] | null; }) {
  return (
    <Card>
      <CardHeader title="Autoscaler ceiling" subtitle="Nodes × list price: what the node pool costs now, and the most it can cost if the autoscaler scales to its maximum" />
      {pools === null ? (
        <CardBody className="text-sm text-muted">Node pools are not available.</CardBody>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Pool</Th><Th>Size</Th><Th className="text-right">Nodes</Th><Th className="text-right">Now / month</Th><Th className="text-right">At most / month</Th></tr></thead>
            <tbody>
              {pools.map((p) => (
                <tr key={p.name}>
                  <Td mono>{p.name}</Td>
                  <Td mono>{p.size}</Td>
                  <Td className="text-right tabular-nums">{p.count} of max {p.maxNodes}</Td>
                  <Td className="text-right tabular-nums">{usd(p.nowMonthly)}</Td>
                  <Td className="text-right tabular-nums font-medium">{usd(p.maxMonthly)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

export function DropletsCard({ droplets }: { droplets: (PricedThing & { backups: number | null })[] }) {
  return (
    <Card>
      <CardHeader title="Droplets outside the cluster" subtitle="From the invoice. The dashboard never connects to these Droplets." />
      {droplets.length === 0 ? (
        <CardBody className="text-sm text-muted">No Droplet is billed outside the cluster this month.</CardBody>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Droplet</Th><Th>Size</Th><Th className="text-right">So far</Th><Th className="text-right">Full month</Th><Th className="text-right">Backups / month</Th></tr></thead>
            <tbody>
              {droplets.map((d) => (
                <tr key={d.name}>
                  <Td mono>{d.name}{d.running ? null : <span className="ml-2"><Badge>Stopped</Badge></span>}</Td>
                  <Td mono>{d.detail}</Td>
                  <Td className="text-right tabular-nums">{usd(d.amount)}</Td>
                  <Td className="text-right tabular-nums font-medium">{usd(d.monthly)}</Td>
                  <Td className="text-right tabular-nums">{d.backups === null ? "none" : usd(d.backups)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

export function SnapshotsCard({ lines }: { lines: LineCost[] }) {
  return (
    <Card>
      <CardHeader title="Snapshots and backups" subtitle="Easy to forget, and billed every month they exist" />
      {lines.length === 0 ? (
        <CardBody className="text-sm text-muted">No snapshot or backup is billed this month.</CardBody>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Kind</Th><Th>What</Th><Th className="text-right">So far</Th><Th className="text-right">Month (projected)</Th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={`${l.description}-${i}`}>
                  <Td>{l.product}</Td>
                  <Td wrap className="font-mono text-xs">{l.description}</Td>
                  <Td className="text-right tabular-nums">{usd(l.amount)}</Td>
                  <Td className="text-right tabular-nums font-medium">{usd(l.projected)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
