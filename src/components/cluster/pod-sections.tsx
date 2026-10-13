import Link from "next/link";
import { stringify } from "yaml";
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip, CodeBlock, EmptyState, KeyValue, Mono } from "@/components/ui/misc";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatAge, formatBytes, formatCpu } from "@/lib/format";
import type { ContainerStateView, ContainerView, PodDetail, ResourceTriple } from "@/lib/k8s/types";
import { ResourceLine, fmt } from "./resource-line";

const when = (iso?: string) => (iso ? `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)} UTC (${formatAge(iso)} ago)` : undefined);

// ---------------------------------------------------------------------------
export function PodOverview({ d }: { d: PodDetail }) {
  const r = d.row;
  // Top of the chain first: Deployment, then the ReplicaSet that owns the pod.
  const order: Record<string, number> = { Deployment: 0, StatefulSet: 0, DaemonSet: 0, Job: 0, CronJob: 0, ReplicaSet: 1 };
  const chain = d.owners.filter((o) => o.controller || o.kind === "Deployment").sort((a, b) => (order[a.kind] ?? 2) - (order[b.kind] ?? 2));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Details" subtitle="Status, restarts, node, IP and age are in the header above" />
        <CardBody>
          <KeyValue
            columns={3}
            items={[
              { label: "Phase", value: r.phase },
              { label: "QoS class", value: r.qos },
              { label: "Restart policy", value: d.scheduling.restartPolicy },
              { label: "Host IP", value: d.network.hostIp, mono: true },
              { label: "Service account", value: d.security.serviceAccount, mono: true },
              { label: "Helm release", value: r.release, mono: true },
              { label: "Namespace", value: <Link className="font-mono text-xs hover:text-accent" href={`/namespaces/${encodeURIComponent(r.namespace)}`}>{r.namespace}</Link> },
              { label: "Created", value: when(r.createdAt) },
              { label: "UID", value: d.uid, mono: true },
              {
                label: "Controlled by",
                wide: true,
                value: chain.length ? (
                  <ol className="space-y-1 font-mono text-xs">
                    {chain.map((o, i) => (
                      <li key={`${o.kind}-${o.name}`} className="flex items-baseline gap-2" style={{ paddingLeft: `${i * 1.25}rem` }}>
                        {i > 0 ? <span className="text-muted" aria-hidden>↳</span> : null}
                        <Badge>{o.kind}</Badge>
                        <span className="break-all">{o.name}</span>
                      </li>
                    ))}
                  </ol>
                ) : "None (standalone pod)",
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Conditions" subtitle="Kubernetes’ own checklist for this pod" />
        {d.conditions.length ? (
          <TableWrap>
            <Table>
              <thead><tr><Th>Type</Th><Th>Status</Th><Th>Reason</Th><Th>Message</Th><Th>Since</Th></tr></thead>
              <tbody>
                {d.conditions.map((c) => (
                  <tr key={c.type}>
                    <Td>{c.type}</Td>
                    <Td><Badge tone={c.status === "True" ? "success" : "danger"}>{c.status}</Badge></Td>
                    <Td>{c.reason ?? "—"}</Td>
                    <Td wrap className="max-w-xl text-muted">{c.message ?? "—"}</Td>
                    <Td className="tabular-nums text-muted">{formatAge(c.lastTransition)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : <EmptyState title="No conditions reported yet" />}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Labels" />
          <CardBody className="flex flex-wrap gap-1.5">
            {Object.entries(d.labels).length ? Object.entries(d.labels).map(([k, v]) => <Chip key={k}>{k}={v}</Chip>) : <span className="text-sm text-muted">None</span>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Annotations" subtitle="last-applied-configuration is hidden" />
          <CardBody className="space-y-1.5">
            {Object.entries(d.annotations).length ? Object.entries(d.annotations).map(([k, v]) => (
              <div key={k} className="min-w-0 text-xs"><span className="font-mono text-muted">{k}</span><div className="break-all font-mono">{v}</div></div>
            )) : <span className="text-sm text-muted">None</span>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function StateBadge({ state }: { state: ContainerStateView }) {
  if (state.kind === "running") return <Badge tone="success">Running</Badge>;
  if (state.kind === "waiting") return <Badge tone="warning">Waiting{state.reason ? `: ${state.reason}` : ""}</Badge>;
  if (state.kind === "terminated") return <Badge tone={state.exitCode === 0 ? "neutral" : "danger"}>Terminated{state.reason ? `: ${state.reason}` : ""}{state.exitCode !== undefined ? ` (exit ${state.exitCode})` : ""}</Badge>;
  return <Badge>Unknown</Badge>;
}

function ContainerCard({ c }: { c: ContainerView }) {
  return (
    <Card>
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{c.name}</span>{c.isInit ? <Badge tone="info">init</Badge> : null}<StateBadge state={c.state} />{c.ready ? <Badge tone="success">ready</Badge> : <Badge tone="warning">not ready</Badge>}</span>}
        subtitle={<span className="font-mono">{c.image}</span>}
      />
      <CardBody className="space-y-5">
        <KeyValue
          columns={3}
          items={[
            { label: "Restarts", value: c.restartCount },
            { label: "Image pull policy", value: c.imagePullPolicy },
            { label: "Started", value: when(c.state.startedAt) },
            { label: "Image digest", value: c.imageId, mono: true },
            { label: "Container ID", value: c.containerId, mono: true },
            { label: "State message", value: c.state.message },
          ]}
        />

        {c.lastState ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-warning"><AlertTriangle className="size-4" />Last termination</p>
            <p className="mt-1 text-xs text-muted">
              {c.lastState.reason ?? "—"}{c.lastState.exitCode !== undefined ? ` · exit code ${c.lastState.exitCode}` : ""}
              {c.lastState.finishedAt ? ` · ${when(c.lastState.finishedAt)}` : ""}
              {c.lastState.message ? ` · ${c.lastState.message}` : ""}
            </p>
          </div>
        ) : null}

        {c.command?.length || c.args?.length ? (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Command</h3>
            <div className="rounded-md border border-border bg-surface-2 p-2.5 font-mono text-xs break-all">{[...(c.command ?? []), ...(c.args ?? [])].join(" ")}</div>
          </div>
        ) : null}

        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Ports</h3>
          {c.ports.length ? <div className="flex flex-wrap gap-1.5">{c.ports.map((p) => <Chip key={`${p.containerPort}${p.protocol}`}>{p.name ? `${p.name}: ` : ""}{p.containerPort}/{p.protocol}{p.hostPort ? ` (host ${p.hostPort})` : ""}</Chip>)}</div> : <p className="text-sm text-muted">No ports declared.</p>}
        </div>

        <div>
          <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">Environment</h3>
          {c.env.length || c.envFrom.length ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <TableWrap>
                <Table>
                  <thead><tr><Th>Name</Th><Th>Source</Th><Th>Reference</Th></tr></thead>
                  <tbody>
                    {c.envFrom.map((e) => (
                      <tr key={`from-${e.kind}-${e.name}`}><Td mono>{e.prefix ? `${e.prefix}*` : "(all keys)"}</Td><Td><Badge tone="accent">{e.kind} (envFrom)</Badge></Td><Td mono>{e.name}{e.optional ? " (optional)" : ""}</Td></tr>
                    ))}
                    {c.env.map((e) => (
                      <tr key={e.name}><Td mono>{e.name}</Td><Td><Badge tone={e.source === "literal" ? "neutral" : "accent"}>{e.source}</Badge></Td><Td wrap mono className="max-w-xl">{e.source === "literal" ? (e.value === "" ? <span className="text-muted">(empty)</span> : e.value) : e.ref}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </div>
          ) : <p className="text-sm text-muted">No environment variables set on the container.</p>}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Health probes</h3>
            {c.probes.length ? (
              <div className="space-y-1.5">
                {c.probes.map((p) => (
                  <div key={p.kind} className="rounded-md border border-border bg-surface-2 p-2.5 text-xs">
                    <p className="flex items-center gap-2"><Badge>{p.kind}</Badge><span className="font-mono">{p.type} {p.target}</span></p>
                    <p className="mt-1 text-muted">delay {p.initialDelaySeconds ?? 0}s · every {p.periodSeconds ?? 10}s · timeout {p.timeoutSeconds ?? 1}s · fail after {p.failureThreshold ?? 3}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted">No probes configured.</p>}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Volume mounts</h3>
            {c.mounts.length ? (
              <div className="space-y-1">
                {c.mounts.map((m) => <div key={`${m.name}${m.mountPath}`} className="flex flex-wrap items-center gap-x-2 text-xs"><span className="font-mono">{m.mountPath}</span><ArrowRight className="size-3 text-muted" /><span className="font-mono text-muted">{m.name}</span>{m.readOnly ? <Badge>ro</Badge> : null}</div>)}
              </div>
            ) : <p className="text-sm text-muted">Nothing mounted.</p>}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export function PodContainers({ d }: { d: PodDetail }) {
  return <div className="space-y-4">{d.containers.map((c) => <ContainerCard key={`${c.isInit}-${c.name}`} c={c} />)}</div>;
}

// ---------------------------------------------------------------------------
function insights(kind: "cpu" | "memory", t: ResourceTriple, active: boolean): { tone: "danger" | "warning" | "info"; text: string }[] {
  const out: { tone: "danger" | "warning" | "info"; text: string }[] = [];
  const name = kind === "cpu" ? "CPU" : "Memory";
  if (!t.request && !t.limit) out.push({ tone: "warning", text: `No ${name} request or limit: the scheduler can’t plan for this pod.` });
  else if (!t.limit) out.push({ tone: "info", text: `No ${name} limit: it can use whatever the node has free.` });
  if (!active) return out;
  if (t.usage !== null && t.limit && t.usage / t.limit >= 0.85) out.push({ tone: "danger", text: kind === "memory" ? "Memory is near its limit: the container may be OOMKilled." : "CPU is near its limit: it is probably being throttled." });
  if (t.usage !== null && t.request && t.usage > t.request) out.push({ tone: "info", text: `Using more ${name} than requested (${Math.round((t.usage / t.request) * 100)}% of request).` });
  if (t.usage !== null && t.request && t.usage / t.request < 0.1) out.push({ tone: "info", text: `Uses under 10% of its ${name} request: the request may be larger than needed.` });
  return out;
}

function ResourceBlock({ title, kind, t, active }: { title: string; kind: "cpu" | "memory"; t: ResourceTriple; active: boolean }) {
  // With a limit the bar is "how close to the limit". Without one there is no ceiling, so the bar is just
  // scaled to fit and stays neutral instead of turning red.
  const ceiling = t.limit || Math.max(t.request, t.usage ?? 0) * 1.25 || 1;
  const pct = (a: number | null, b: number) => (a !== null && b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <div className="space-y-3">
      <ResourceLine label={title} kind={kind} usage={t.usage} request={t.request} limit={t.limit} max={ceiling} colorize={t.limit > 0} bar={t.limit > 0 || t.request > 0} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <span className="text-muted">Usage <span className="block tabular-nums text-text">{t.usage === null ? "n/a" : fmt(kind, t.usage)}</span></span>
        <span className="text-muted">Request <span className="block tabular-nums text-text">{t.request ? fmt(kind, t.request) : "none"}</span></span>
        <span className="text-muted">Limit <span className="block tabular-nums text-text">{t.limit ? fmt(kind, t.limit) : "none"}</span></span>
        <span className="text-muted">% of request / limit <span className="block tabular-nums text-text">{pct(t.usage, t.request)} / {pct(t.usage, t.limit)}</span></span>
      </div>
      {insights(kind, t, active).map((i) => (
        <p key={i.text} className={`flex items-start gap-1.5 text-xs ${i.tone === "danger" ? "text-danger" : i.tone === "warning" ? "text-warning" : "text-muted"}`}>
          {i.tone === "info" ? <Info className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
          {i.text}
        </p>
      ))}
    </div>
  );
}

export function PodResources({ d, metricsAvailable }: { d: PodDetail; metricsAvailable: boolean }) {
  const regular = d.containers.filter((c) => !c.isInit);
  // Usage hints are only meaningful for a pod that is actually running.
  const active = d.row.phase === "Running" && d.row.health === "healthy";
  return (
    <div className="space-y-4">
      {!metricsAvailable ? <Card className="border-warning/40"><CardBody className="text-sm text-warning">metrics-server is not answering, so only requests and limits are shown.</CardBody></Card> : null}
      <Card>
        <CardHeader title="Whole pod" subtitle={`QoS class: ${d.row.qos ?? "unknown"} · requests and limits are the sum of its containers`} />
        <CardBody className="grid gap-6 lg:grid-cols-2">
          <ResourceBlock title="CPU" kind="cpu" t={d.row.cpu} active={active} />
          <ResourceBlock title="Memory" kind="memory" t={d.row.memory} active={active} />
        </CardBody>
      </Card>
      {regular.map((c) => (
        <Card key={c.name}>
          <CardHeader title={<span className="font-mono">{c.name}</span>} subtitle={`${formatCpu(c.resources.cpu.request)} CPU / ${formatBytes(c.resources.memory.request)} requested`} />
          <CardBody className="grid gap-6 lg:grid-cols-2">
            <ResourceBlock title="CPU" kind="cpu" t={c.resources.cpu} active={active} />
            <ResourceBlock title="Memory" kind="memory" t={c.resources.memory} active={active} />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function PodNetwork({ d, namespace }: { d: PodDetail; namespace: string }) {
  const n = d.network;
  const podDns = n.podIp ? `${n.podIp.replaceAll(".", "-")}.${namespace}.pod.cluster.local` : undefined;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Pod addressing" />
        <CardBody>
          <KeyValue
            columns={3}
            items={[
              { label: "Pod IP", value: n.podIps.length ? n.podIps.join(", ") : n.podIp, mono: true },
              { label: "Host (node) IP", value: n.hostIp, mono: true },
              { label: "Host network", value: n.hostNetwork ? "Yes: shares the node’s network" : "No" },
              { label: "DNS policy", value: n.dnsPolicy },
              { label: "Pod DNS name", value: podDns, mono: true },
              { label: "Hostname / subdomain", value: [n.hostname, n.subdomain].filter(Boolean).join(" / ") || undefined, mono: true },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Container ports" />
        {n.ports.length ? (
          <TableWrap>
            <Table>
              <thead><tr><Th>Container</Th><Th>Name</Th><Th>Port</Th><Th>Protocol</Th><Th>In-cluster address</Th></tr></thead>
              <tbody>{n.ports.map((p) => <tr key={`${p.container}${p.port}${p.protocol}`}><Td mono>{p.container}</Td><Td mono>{p.name ?? "—"}</Td><Td className="tabular-nums">{p.port}</Td><Td>{p.protocol}</Td><Td mono>{n.podIp ? `${n.podIp}:${p.port}` : "—"}</Td></tr>)}</tbody>
            </Table>
          </TableWrap>
        ) : <EmptyState title="No ports declared" hint="The pod can still open ports, but it hasn’t declared any." />}
      </Card>

      <Card>
        <CardHeader title="Services that route to this pod" subtitle="Matched by the service’s label selector" />
        {n.services.length ? (
          <div className="divide-y divide-border">
            {n.services.map((s) => (
              <div key={s.name} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{s.name}</span>
                  <Badge tone={s.type === "LoadBalancer" ? "accent" : "neutral"}>{s.type}</Badge>
                  <span className="font-mono text-xs text-muted">{s.name}.{namespace}.svc.cluster.local</span>
                </div>
                <KeyValue
                  columns={3}
                  items={[
                    { label: "Cluster IP", value: s.clusterIp, mono: true },
                    { label: "Ports", value: <div className="flex flex-wrap gap-1.5">{s.ports.map((p) => <Chip key={`${p.port}${p.protocol}`}>{p.name ? `${p.name}: ` : ""}{p.port}→{p.targetPort}/{p.protocol}{p.nodePort ? ` (node ${p.nodePort})` : ""}</Chip>)}</div> },
                    { label: "External / load balancer", value: [...s.loadBalancer, ...s.externalIps].join(", ") || undefined, mono: true },
                  ]}
                />
                {s.ingresses.length ? (
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Public routes (Ingress)</p>
                    <div className="space-y-1.5">
                      {s.ingresses.flatMap((i) => i.rules.filter((r) => r.serviceName === s.name).map((r, idx) => (
                        <div key={`${i.name}${idx}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <Mono>https://{r.host ?? "*"}{r.path}</Mono><ArrowRight className="size-3 text-muted" /><Mono>{r.serviceName}:{r.servicePort}</Mono>
                          <span className="text-muted">via {i.name}{i.className ? ` (${i.className})` : ""}</span>
                          {i.tls.length ? <Badge tone="success">TLS {i.tls.map((t) => t.secretName).filter(Boolean).join(", ")}</Badge> : <Badge tone="warning">no TLS</Badge>}
                          {i.address.length ? <span className="font-mono text-muted">{i.address.join(", ")}</span> : null}
                        </div>
                      )))}
                    </div>
                  </div>
                ) : <p className="text-xs text-muted">Not exposed through an Ingress: reachable only inside the cluster{s.type === "LoadBalancer" ? " and through its load balancer" : ""}.</p>}
              </div>
            ))}
          </div>
        ) : <EmptyState title="No Service selects this pod" hint={n.podIp ? `It is reachable only by its pod IP (${n.podIp}) inside the cluster.` : "The pod has no IP yet."} />}
      </Card>

      <p className="flex items-start gap-1.5 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" />Network policies and live traffic flows are not shown in this version.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function PodStorage({ d }: { d: PodDetail }) {
  const refs = d.containers.flatMap((c) => c.envFrom.map((e) => ({ ...e, container: c.name })));
  const secretEnv = d.containers.flatMap((c) => c.env.filter((e) => e.source === "secret" || e.source === "configmap").map((e) => ({ ...e, container: c.name })));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Volumes" subtitle="Only names are shown, never the contents of secrets" />
        {d.volumes.length ? (
          <TableWrap>
            <Table>
              <thead><tr><Th>Name</Th><Th>Type</Th><Th>Source</Th><Th>Details</Th></tr></thead>
              <tbody>
                {d.volumes.map((v) => (
                  <tr key={v.name}>
                    <Td mono>{v.name}</Td>
                    <Td><Badge tone={v.type === "pvc" ? "accent" : "neutral"}>{v.type}</Badge></Td>
                    <Td mono>{v.source}</Td>
                    <Td className="text-xs text-muted">
                      {v.pvc ? `${v.pvc.status} · ${formatBytes(v.pvc.capacityBytes || v.pvc.requestedBytes)} · ${v.pvc.storageClass ?? "no class"} · ${v.pvc.accessModes.join(", ")}` : v.detail ?? ""}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : <EmptyState title="No volumes" />}
      </Card>

      <Card>
        <CardHeader title="Configuration sources" subtitle="Secrets and ConfigMaps this pod reads" />
        {refs.length || secretEnv.length ? (
          <TableWrap>
            <Table>
              <thead><tr><Th>Container</Th><Th>How</Th><Th>Kind</Th><Th>Reference</Th></tr></thead>
              <tbody>
                {refs.map((r) => <tr key={`${r.container}-${r.kind}-${r.name}`}><Td mono>{r.container}</Td><Td>envFrom (all keys)</Td><Td><Badge tone="accent">{r.kind}</Badge></Td><Td mono>{r.name}</Td></tr>)}
                {secretEnv.map((r) => <tr key={`${r.container}-${r.name}`}><Td mono>{r.container}</Td><Td>env {r.name}</Td><Td><Badge tone="accent">{r.source}</Badge></Td><Td mono>{r.ref}</Td></tr>)}
              </tbody>
            </Table>
          </TableWrap>
        ) : <EmptyState title="No Secret or ConfigMap references" />}
      </Card>

      <Card>
        <CardHeader title="Identity" />
        <CardBody>
          <KeyValue items={[
            { label: "Service account", value: d.security.serviceAccount, mono: true },
            { label: "Image pull secrets", value: d.security.imagePullSecrets.length ? d.security.imagePullSecrets.join(", ") : undefined, mono: true },
          ]} />
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function PodScheduling({ d }: { d: PodDetail }) {
  const s = d.scheduling;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Scheduling" />
        <CardBody>
          <KeyValue columns={3} items={[
            { label: "Node", value: s.nodeName ? <Link className="font-mono text-xs hover:text-accent" href={`/nodes/${encodeURIComponent(s.nodeName)}`}>{s.nodeName}</Link> : "Not scheduled" },
            { label: "Scheduler", value: s.schedulerName, mono: true },
            { label: "Priority class", value: s.priorityClass ?? (s.priority !== undefined ? `priority ${s.priority}` : undefined), mono: true },
            { label: "Restart policy", value: s.restartPolicy },
            { label: "Termination grace period", value: s.terminationGracePeriodSeconds !== undefined ? `${s.terminationGracePeriodSeconds}s` : undefined },
          ]} />
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Node selector" />
          <CardBody className="flex flex-wrap gap-1.5">{Object.entries(s.nodeSelector).length ? Object.entries(s.nodeSelector).map(([k, v]) => <Chip key={k}>{k}={v}</Chip>) : <span className="text-sm text-muted">None</span>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Tolerations" />
          {s.tolerations.length ? (
            <TableWrap>
              <Table>
                <thead><tr><Th>Key</Th><Th>Operator</Th><Th>Value</Th><Th>Effect</Th><Th>Seconds</Th></tr></thead>
                <tbody>{s.tolerations.map((t, i) => <tr key={`${t.key}${i}`}><Td mono>{t.key ?? "*"}</Td><Td>{t.operator ?? "Equal"}</Td><Td mono>{t.value ?? "—"}</Td><Td>{t.effect ?? "any"}</Td><Td className="tabular-nums">{t.tolerationSeconds ?? "—"}</Td></tr>)}</tbody>
              </Table>
            </TableWrap>
          ) : <EmptyState title="None" />}
        </Card>
      </div>
      {s.affinity ? <Card><CardHeader title="Affinity" /><CardBody><CodeBlock label="Affinity">{JSON.stringify(s.affinity, null, 2)}</CodeBlock></CardBody></Card> : null}
    </div>
  );
}

export function PodRaw({ d }: { d: PodDetail }) {
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-1.5 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" />The pod object as Kubernetes returns it, without managed fields.</p>
      <CodeBlock label="Pod YAML">{stringify(d.raw, { lineWidth: 0 })}</CodeBlock>
    </div>
  );
}
