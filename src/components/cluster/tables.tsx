import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, healthTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Chip, EmptyState, Mono } from "@/components/ui/misc";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatAge, formatBytes } from "@/lib/format";
import type { EventView, IngressView, PvcView, ServiceView, WorkloadView } from "@/lib/k8s/types";

export function WorkloadsTable({ workloads }: { workloads: WorkloadView[] }) {
  if (!workloads.length) return <Card><EmptyState title="No workloads" hint="This namespace has no Deployments, StatefulSets or DaemonSets." /></Card>;
  return (
    <Card>
      <TableWrap>
        <Table>
          <thead><tr><Th>Name</Th><Th>Kind</Th><Th>Ready</Th><Th>Images</Th><Th>Helm release</Th><Th>Age</Th></tr></thead>
          <tbody>
            {workloads.map((w) => (
              <tr key={`${w.kind}/${w.name}`}>
                <Td mono>{w.name}</Td>
                <Td><Badge>{w.kind}</Badge></Td>
                <Td><Badge tone={healthTone(w.health)}>{w.ready}</Badge></Td>
                <Td><div className="flex max-w-lg flex-col gap-1">{w.images.map((i) => <Chip key={i}>{i}</Chip>)}</div></Td>
                <Td mono>{w.helmRelease ? <Link href={`/helm/${encodeURIComponent(w.namespace)}/${encodeURIComponent(w.helmRelease)}`} className="hover:text-accent">{w.helmRelease}</Link> : (w.release ?? <span className="text-muted">—</span>)}</Td>
                <Td className="tabular-nums text-muted">{formatAge(w.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function ports(s: ServiceView) {
  return s.ports.map((p) => `${p.name ? `${p.name}:` : ""}${p.port}${p.targetPort && p.targetPort !== String(p.port) ? `→${p.targetPort}` : ""}/${p.protocol}${p.nodePort ? ` (node ${p.nodePort})` : ""}`);
}

export function ServicesTable({ services, namespace }: { services: ServiceView[]; namespace: string }) {
  if (!services.length) return <Card><EmptyState title="No services" /></Card>;
  return (
    <Card>
      <TableWrap>
        <Table>
          <thead><tr><Th>Name</Th><Th>Type</Th><Th>Cluster IP</Th><Th>Ports</Th><Th>External / LB</Th><Th>Selector</Th><Th>Exposed at</Th></tr></thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name}>
                <Td mono><div>{s.name}</div><div className="text-[11px] text-muted">{s.name}.{namespace}.svc.cluster.local</div></Td>
                <Td><Badge tone={s.type === "LoadBalancer" ? "accent" : "neutral"}>{s.type}</Badge></Td>
                <Td mono>{s.clusterIp ?? "—"}</Td>
                <Td><div className="flex flex-col gap-1">{ports(s).map((p) => <Chip key={p}>{p}</Chip>)}</div></Td>
                <Td mono>{[...s.loadBalancer, ...s.externalIps].join(", ") || <span className="text-muted">—</span>}</Td>
                <Td><div className="flex max-w-xs flex-wrap gap-1">{Object.entries(s.selector).map(([k, v]) => <Chip key={k}>{k}={v}</Chip>)}</div></Td>
                <Td>{s.ingresses.length ? <div className="flex flex-col gap-0.5">{s.ingresses.flatMap((i) => i.hosts).map((h) => <Mono key={h}>https://{h}</Mono>)}</div> : <span className="text-muted">cluster only</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

export function IngressTable({ ingresses }: { ingresses: IngressView[] }) {
  if (!ingresses.length) return <Card><EmptyState title="No ingresses" /></Card>;
  return (
    <Card>
      <TableWrap>
        <Table>
          <thead><tr><Th>Name</Th><Th>Class</Th><Th>Route</Th><Th>TLS secret</Th><Th>Address</Th></tr></thead>
          <tbody>
            {ingresses.map((i) => (
              <tr key={i.name}>
                <Td mono>{i.name}</Td>
                <Td>{i.className ? <Badge>{i.className}</Badge> : "—"}</Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    {i.rules.map((r, idx) => (
                      <span key={`${r.host}${r.path}${idx}`} className="inline-flex items-center gap-1.5 font-mono text-xs">
                        {r.host ?? "*"}{r.path}<ArrowRight className="size-3 text-muted" />{r.serviceName}:{r.servicePort}
                      </span>
                    ))}
                  </div>
                </Td>
                <Td mono>{i.tls.map((t) => t.secretName).filter(Boolean).join(", ") || <span className="text-muted">none</span>}</Td>
                <Td mono>{i.address.join(", ") || <span className="text-muted">pending</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

export function PvcTable({ pvcs }: { pvcs: PvcView[] }) {
  if (!pvcs.length) return <Card><EmptyState title="No persistent volume claims" /></Card>;
  return (
    <Card>
      <TableWrap>
        <Table>
          <thead><tr><Th>Claim</Th><Th>Status</Th><Th>Size</Th><Th>Storage class</Th><Th>Access</Th><Th>Volume</Th><Th>Used by</Th><Th>Age</Th></tr></thead>
          <tbody>
            {pvcs.map((p) => (
              <tr key={p.name}>
                <Td mono>{p.name}</Td>
                <Td><Badge tone={p.status === "Bound" ? "success" : "warning"}>{p.status}</Badge></Td>
                <Td className="tabular-nums">{formatBytes(p.capacityBytes || p.requestedBytes)}</Td>
                <Td mono>{p.storageClass ?? "—"}</Td>
                <Td mono>{p.accessModes.join(", ")}</Td>
                <Td mono>{p.volumeName ?? "—"}</Td>
                <Td>
                  {p.usedBy.length ? <div className="flex flex-col gap-0.5">{p.usedBy.map((pod) => <Link key={pod} href={`/namespaces/${encodeURIComponent(p.namespace)}/pods/${encodeURIComponent(pod)}`} className="font-mono text-xs hover:text-accent">{pod}</Link>)}</div> : <Badge tone="warning">unused</Badge>}
                </Td>
                <Td className="tabular-nums text-muted">{formatAge(p.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

export function EventsTable({ events, showObject = true }: { events: EventView[]; showObject?: boolean }) {
  if (!events.length) return <Card><EmptyState title="No events" hint="Kubernetes only keeps events for about an hour." /></Card>;
  return (
    <Card>
      <TableWrap>
        <Table>
          <thead><tr><Th>Last seen</Th><Th>Type</Th><Th>Reason</Th>{showObject ? <Th>Object</Th> : null}<Th>Message</Th><Th>Count</Th></tr></thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={`${e.reason}-${e.lastSeen}-${i}`}>
                <Td className="tabular-nums text-muted">{formatAge(e.lastSeen)}</Td>
                <Td><Badge tone={e.type === "Warning" ? "warning" : "neutral"}>{e.type}</Badge></Td>
                <Td>{e.reason}</Td>
                {showObject ? <Td mono>{e.object ?? "—"}</Td> : null}
                <Td wrap className="max-w-2xl text-muted">{e.message}</Td>
                <Td className="tabular-nums">{e.count}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

