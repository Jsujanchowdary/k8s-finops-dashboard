// The text the assistant is allowed to see: a compact picture of the cluster as it is right now.
//
// What goes to Google is decided here and nowhere else. It is names, statuses, IPs, images, resource numbers,
// how things connect and, when a DigitalOcean token is set, the account's billing (the same figures as the FinOps page).
// It never includes environment-variable values, Secrets, ConfigMaps, annotations or container logs; a guard test
// keeps this file from touching those.

import type { LoadedCluster } from "@/lib/data";
import { monthly } from "@/lib/finops/allocation";
import { usd, usdRate } from "@/lib/finops/format";
import { HOURS_CAP } from "@/lib/finops/spend";
import type { FinopsView } from "@/lib/finops/view";
import { formatAge, formatBytes, formatCpu } from "@/lib/format";
import { buildEventViews, buildIngressViews, buildPvcViews, buildServiceViews, buildWorkloads } from "@/lib/k8s/views";
import { CAPABILITIES } from "@/lib/k8s/access";
import { buildTopology, podReady, serviceSelects } from "@/lib/topology/build";
import type { EvidenceIndex } from "./answer";
import { emptyIndex } from "./answer";

export interface Snapshot {
  text: string;
  generatedAt: string;
  counts: { nodes: number; namespaces: number; pods: number; services: number; ingresses: number; pvcs: number; helmReleases: number };
  index: EvidenceIndex;
}

const MAX_PODS = 700;
const MAX_EVENTS = 40;
const MAX_INVOICE_LINES = 60;

/** What the assistant gets about money: the FinOps figures, or why there are none. */
export type SnapshotCost = { state: "ok"; view: FinopsView } | { state: "unavailable"; reason: string };

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const one = (text: string) => text.replace(/\s+/g, " ").trim();

function shortImage(image: string): string {
  const parts = image.replace(/@sha256:[0-9a-f]+$/i, "").split("/");
  return parts.length > 1 && /[.:]/.test(parts[0]) ? parts.slice(1).join("/") : image;
}

/** "12m (request 50m, limit 500m)", leaving out what is not set. */
function cpuText(usage: number | null, request: number, limit: number): string {
  const parts = [`request ${request ? formatCpu(request) : "none"}`, `limit ${limit ? formatCpu(limit) : "none"}`];
  return `${usage === null ? "n/a" : formatCpu(usage)} (${parts.join(", ")})`;
}

function memText(usage: number | null, request: number, limit: number): string {
  const parts = [`request ${request ? formatBytes(request) : "none"}`, `limit ${limit ? formatBytes(limit) : "none"}`];
  const pct = usage !== null && limit > 0 ? `, ${Math.round((usage / limit) * 100)}% of limit` : "";
  return `${usage === null ? "n/a" : formatBytes(usage)} (${parts.join(", ")}${pct})`;
}

/** The billing section: what was spent, what it will be, where it goes, and what the cluster costs per namespace now. */
function costSection(cost: SnapshotCost | undefined, line: (text: string) => void): void {
  if (!cost) return;
  if (cost.state === "unavailable") {
    line(`\n## Costs\nNot available: ${cost.reason}`);
    return;
  }
  const v = cost.view;
  const s = v.spend;
  line(`\n## Costs (DigitalOcean billing for the whole account, USD)`);
  line(
    `Billing month ${v.period} (UTC).` +
      (s ? ` The invoice data runs to ${s.coverageEnd}; DigitalOcean regenerates it about once a day. Hours left in the month after that: ${Math.round(s.hoursLeft)}.` : " This month's invoice lines could not be read."),
  );
  line("How the figures are worked out (the same as the dashboard's FinOps page):");
  line(`- rate per hour of an invoice line = amount so far / billed hours (for daily-billed lines such as backups: the last full day's charge / 24).`);
  line(`- projected month = so far + rate x hours left, never above rate x ${HOURS_CAP} (DigitalOcean bills one resource at most ${HOURS_CAP} hours a month). Stopped lines stay at what they cost. Tax follows at the rate seen so far.`);
  line(`- a full month of a resource = rate x ${HOURS_CAP}. Projections assume everything keeps running as it is now.`);
  if (v.balance) line(`- Spent this month (account balance): ${usd(v.balance.monthToDateUsage)} as of ${v.balance.generatedAt ?? "?"}.`);
  if (s) {
    line(`- Itemised on this month's invoice: ${usd(s.itemisedTotal)} (before tax ${usd(s.pretax)}, tax ${usd(s.tax)}).`);
    line(`- Projected for the whole month: ${usd(s.projectedTotal)} (before tax ${usd(s.projectedPretax)}, tax ${usd(s.projectedTax)}).`);
    line(`- Burn rate of what runs now: ${usdRate(s.burnPerHour)}/h before tax, ${usd(s.burnPerHour * 24)}/day.`);
    line(`- Cluster "${v.clusterName ?? "?"}": ${usd(s.cluster.amount)} so far, ${usd(s.cluster.projected)} projected. Everything else on the account: ${usd(s.other.amount)} so far, ${usd(s.other.projected)} projected.`);
  }
  line(`- Past invoices: ${v.invoices.length ? v.invoices.map((i) => `${i.period} ${usd(i.amount)}`).join(", ") : "none"}.`);

  if (s) {
    line("### By product (so far -> projected month)");
    for (const g of s.byProduct) line(`- ${g.name}: ${usd(g.amount)} -> ${usd(g.projected)} (${g.count} line${g.count === 1 ? "" : "s"})`);
    line("### By DigitalOcean project, before tax (so far -> projected month)");
    for (const g of s.byProject) line(`- ${g.name}: ${usd(g.amount)} -> ${usd(g.projected)}`);

    line(`### Invoice lines (product | resource | cluster | project | status | rate/h | so far | projected month | billed from -> to)`);
    for (const l of s.lines.slice(0, MAX_INVOICE_LINES)) {
      const status = l.isTax ? "tax" : l.running ? "still billed" : l.amount > 0 ? "stopped" : "free";
      line(`- ${l.product} | ${one(l.description)} | ${l.groupDescription ?? "-"} | ${l.projectName ?? "-"} | ${status} | ${l.rate > 0 ? usdRate(l.rate) : "-"} | ${usd(l.amount)} | ${usd(l.projected)} | ${l.start ?? "?"} -> ${l.end ?? "?"}`);
    }
    if (s.lines.length > MAX_INVOICE_LINES) line(`(and ${s.lines.length - MAX_INVOICE_LINES} smaller lines)`);

    line("### Node pool resizes seen on the invoice");
    if (s.nodeChanges.length === 0) line("(none this month)");
    for (const c of s.nodeChanges) {
      const before = s.lines.find((l) => l.description === c.from);
      const after = s.lines.find((l) => l.description === c.to);
      const rates = before && after && before.rate > 0 ? ` Rate ${usdRate(before.rate)}/h -> ${usdRate(after.rate)}/h; a full month ${usd(monthly(before.rate))} -> ${usd(monthly(after.rate))} (difference ${usd(monthly(after.rate) - monthly(before.rate))} a month).` : "";
      line(`- ${c.at}: "${c.from}" replaced by "${c.to}".${rates}`);
    }
  }

  if (v.daily) {
    const days = (rows: { date: string; amount: number }[]) => rows.map((r) => `${r.date.slice(8)}: ${usd(r.amount)}`).join(", ");
    line(`### Spend per UTC day, tax included (Billing Insights; can differ slightly from the invoice)`);
    line(`- ${v.period} up to ${v.daily.lastDay}: ${days(v.daily.current) || "none yet"}`);
    line(`- ${v.previousPeriod}: ${days(v.daily.previous) || "no data"}`);
  }

  const a = v.allocation;
  if (a) {
    line(`### Cluster cost per namespace right now (an estimate of the current rate, not a history)`);
    line(`Method: node price split 50% CPU / 50% memory; each pod pays max(request, usage) at those rates; volumes go to the namespace that claims them; load balancers are shared; the rest of the node is idle capacity.`);
    line(`Cluster total ${usdRate(a.total)}/h, about ${usd(monthly(a.total))} for a full month. The invoice's current rate for the cluster: ${usdRate(a.invoiceRate)}/h.`);
    for (const n of a.namespaces) {
      const unused = n.unusedCpu === null || n.unusedMemory === null ? "n/a" : usd(monthly(n.unusedCpu + n.unusedMemory));
      line(`- ${n.namespace} | pods ${n.pods} | ${usdRate(n.total)}/h, ~${usd(monthly(n.total))}/month | CPU ${usdRate(n.cpu)}/h, memory ${usdRate(n.memory)}/h, storage ${usdRate(n.storage)}/h | requested but unused ~${unused}/month`);
    }
    line(`- idle capacity (paid for, not reserved or used) | ${usdRate(a.idle.total)}/h, ~${usd(monthly(a.idle.total))}/month`);
    for (const sh of a.shared) line(`- shared load balancer ${sh.owner ?? sh.name} | ${usdRate(sh.hourly)}/h, ~${usd(monthly(sh.hourly))}/month`);
    for (const u of a.unclaimedVolumes) line(`- volume with no claim ${u.name} | ${usdRate(u.hourly)}/h`);
  }
}

export function buildSnapshot(data: LoadedCluster, now: number = Date.now(), cost?: SnapshotCost): Snapshot {
  const index = emptyIndex();
  const out: string[] = [];
  const line = (text: string) => out.push(text);
  const generatedAt = new Date(now).toISOString();

  const bundle = data.bundle;
  const services = buildServiceViews(bundle);
  const ingresses = buildIngressViews(bundle);
  const pvcs = buildPvcViews(bundle);
  const workloads = buildWorkloads(bundle);

  const c = data.connection;
  line(`# Cluster snapshot taken ${generatedAt}`);
  line(`Cluster ${c.clusterName}${c.provider ? ` on ${c.provider}` : ""}${c.region ? ` (${c.region})` : ""}, Kubernetes ${c.version ?? "unknown"}. Live CPU and memory usage from metrics-server: ${c.metricsAvailable ? "available" : "NOT available"}.`);
  for (const w of data.warnings) line(`Data warning: ${one(w)}`);

  // ---- nodes ----
  line("\n## Nodes");
  for (const n of data.nodes) {
    index.node.add(n.name);
    const problems = n.conditions.filter((cond) => cond.health === "warning" || cond.health === "critical").map((cond) => `${cond.type}=${cond.status}${cond.reason ? ` (${cond.reason})` : ""}`);
    line(
      `- ${n.name} | pool ${n.nodePool ?? "?"} | ${n.instanceType ?? "?"} | ${n.ready ? "Ready" : "NOT Ready"}${n.unschedulable ? " (cordoned)" : ""} | roles ${n.roles.join(",") || "none"} | kubelet ${n.kubeletVersion} | internal ${n.internalIp ?? "?"} external ${n.externalIp ?? "none"}` +
        ` | CPU allocatable ${formatCpu(n.cpu.allocatable)}, requested ${formatCpu(n.cpu.requests)}, in use ${n.cpu.usage === null ? "n/a" : formatCpu(n.cpu.usage)}` +
        ` | memory allocatable ${formatBytes(n.memory.allocatable)}, requested ${formatBytes(n.memory.requests)}, in use ${n.memory.usage === null ? "n/a" : formatBytes(n.memory.usage)}` +
        ` | pods ${n.pods.count}/${n.pods.capacity} | problem conditions: ${problems.join(", ") || "none"} | taints: ${n.taints.join(", ") || "none"}`,
    );
  }

  if (data.nodePools.state === "ok") {
    line("\n## Node pools (from the DigitalOcean API)");
    for (const p of data.nodePools.pools) {
      line(`- ${p.name} | size ${p.size} | nodes now ${p.count} | autoscaling ${p.autoScale ? `on, min ${p.minNodes ?? "?"} max ${p.maxNodes ?? "?"}` : "off"} | nodes: ${p.nodeNames.join(", ") || "none"}`);
    }
  } else {
    line(`\n## Node pools\nNot available (${data.nodePools.state}).`);
  }

  // ---- namespaces ----
  line("\n## Namespaces");
  for (const ns of data.namespaces) {
    index.namespace.add(ns.name);
    const cpu = ns.cpu.usage === null ? "n/a" : formatCpu(ns.cpu.usage);
    const mem = ns.memory.usage === null ? "n/a" : formatBytes(ns.memory.usage);
    line(`- ${ns.name} | health ${ns.health} | pods ${ns.pods.running}/${ns.pods.total} running, ${ns.pods.unhealthy} need attention | restarts ${ns.restarts} | CPU ${cpu} (requested ${formatCpu(ns.cpu.request)}) | memory ${mem} (requested ${formatBytes(ns.memory.request)}) | volumes ${formatBytes(ns.storageBytes)} | public hosts: ${ns.hosts.join(", ") || "none"}`);
  }

  // ---- pods ----
  line("\n## Pods (namespace/name | status | ready | restarts | node | pod IP | age | controller | CPU | memory | QoS | commit | images)");
  const rows = [...data.rows].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
  for (const r of rows.slice(0, MAX_PODS)) {
    index.pod.add(`${r.namespace}/${r.name}`);
    line(
      `- ${r.namespace}/${r.name} | ${r.status} | ${r.ready} | ${r.restarts} | ${r.nodeName ?? "unscheduled"} | ${r.podIp ?? "no IP"} | ${formatAge(r.createdAt)} | ${r.owner ? `${r.owner.kind}/${r.owner.name}` : "none"}` +
        ` | CPU ${cpuText(r.cpu.usage, r.cpu.request, r.cpu.limit)} | memory ${memText(r.memory.usage, r.memory.request, r.memory.limit)} | ${r.qos ?? "?"} | ${r.commit ?? "no commit"} | ${r.images.map(shortImage).join(", ")}`,
    );
  }
  if (rows.length > MAX_PODS) line(`(${rows.length - MAX_PODS} more pods not listed)`);

  // ---- workloads ----
  line("\n## Workloads");
  for (const w of workloads) {
    index.workload.add(`${w.namespace}/${w.name}`);
    line(`- ${w.namespace}/${w.name} | ${w.kind} | ${w.ready} ready | health ${w.health}${w.strategy ? ` | strategy ${w.strategy}` : ""}${w.helmRelease ? ` | Helm release ${w.helmRelease}` : ""} | ${w.images.map(shortImage).join(", ")}`);
  }

  // ---- services ----
  line("\n## Services");
  for (const s of services) {
    index.service.add(`${s.namespace}/${s.name}`);
    const svc = bundle.services.find((x) => x.metadata?.namespace === s.namespace && x.metadata?.name === s.name);
    const backing = svc ? bundle.pods.filter((p) => p.metadata?.namespace === s.namespace && p.status?.phase !== "Succeeded" && serviceSelects(svc, p)) : [];
    const ready = backing.filter(podReady).length;
    const headless = s.clusterIp === "None";
    line(
      `- ${s.namespace}/${s.name} | ${headless ? "Headless" : s.type} | ${s.clusterIp ?? "no IP"} | ports ${s.ports.map((p) => `${p.port}->${p.targetPort}/${p.protocol}${p.nodePort ? ` nodePort ${p.nodePort}` : ""}`).join(", ") || "none"}` +
        ` | ${Object.keys(s.selector).length ? `selects ${backing.length} pods, ${ready} ready` : "no selector"}${s.loadBalancer.length ? ` | load balancer ${s.loadBalancer.join(", ")}` : ""}${s.ingresses.length ? ` | ingresses ${s.ingresses.map((i) => i.name).join(", ")}` : ""}`,
    );
  }

  // ---- ingresses ----
  line("\n## Ingresses");
  for (const i of ingresses) {
    index.ingress.add(`${i.namespace}/${i.name}`);
    line(`- ${i.namespace}/${i.name} | class ${i.className ?? "none"} | ${i.rules.map((r) => `${r.host ?? "*"}${r.path} -> service ${r.serviceName}:${r.servicePort}`).join("; ") || "no rules"} | TLS ${i.tls.length ? i.tls.flatMap((t) => t.hosts).join(", ") : "none"} | address ${i.address.join(", ") || "none"}`);
  }

  // ---- storage ----
  line("\n## Persistent volume claims");
  for (const v of pvcs) {
    index.pvc.add(`${v.namespace}/${v.name}`);
    line(`- ${v.namespace}/${v.name} | ${v.status} | ${formatBytes(v.capacityBytes || v.requestedBytes)} | class ${v.storageClass ?? "none"} | access ${v.accessModes.join(",") || "?"} | used by ${v.usedBy.join(", ") || "nothing"}`);
  }
  line("(How full each volume is cannot be seen from Kubernetes, only its size.)");

  // ---- helm ----
  line("\n## Helm releases");
  for (const h of data.helm.releases) {
    index.helm.add(`${h.namespace}/${h.name}`);
    line(`- ${h.namespace}/${h.name} | revision ${h.revision ?? "?"} | status ${h.status ?? "?"} | updated ${h.updatedAt ? `${formatAge(h.updatedAt)} ago` : "?"} | health ${h.health} | pods ${h.pods.ready}/${h.pods.total} ready | workloads ${h.workloads.map((w) => w.name).join(", ") || "none"} | commits ${h.commits.join(", ") || "none"}`);
  }

  // ---- how things connect ----
  line("\n## How traffic reaches things, and what workloads are configured to use");
  line("Routing lines come from Ingress rules and Service selectors. 'Configured link' lines are read from literal environment values and are not observed traffic. Links defined only in Secrets or ConfigMaps are not visible.");
  let linkLines = 0;
  for (const ns of data.namespaces) {
    const topo = buildTopology(bundle, data.rows, ns.name);
    const title = new Map(topo.nodes.map((n) => [n.id, `${n.kind} ${n.title}${n.foreign && n.subtitle ? ` [${n.subtitle}]` : ""}`]));
    const edges = topo.edges.filter((e) => !e.toPod && (e.kind === "config" || e.kind === "route"));
    if (edges.length === 0) continue;
    line(`### namespace ${ns.name}`);
    for (const e of edges) {
      line(`- ${e.kind === "config" ? "configured link" : "routes"}: ${title.get(e.from) ?? e.from} -> ${title.get(e.to) ?? e.to}${e.label ? ` (${e.label})` : ""}`);
      linkLines += 1;
    }
    for (const n of topo.nodes.filter((x) => x.kind === "external")) line(`- outside the cluster: ${n.title} (${n.subtitle ?? "external"})`);
  }
  if (linkLines === 0) line("(none found)");

  // ---- access (RBAC) ----
  if (data.access.state === "ok") {
    const { subjects, noAccess } = data.access.report;
    const caps = (s: (typeof subjects)[number]) =>
      s.capabilities.map((c) => `${CAPABILITIES[c.id].label} (${c.scope === "cluster" ? "cluster-wide" : `in ${c.scope.join(", ")}`}${c.limited ? ", named objects only" : ""})`).join("; ") || "nothing notable";
    line("\n## Access (RBAC: who and what can act on the cluster; Secret values are never read, only who may read them)");
    line("People reach the cluster through DigitalOcean: team roles map to Kubernetes groups named do-role-name:<role>, and kubeconfigs issued by DigitalOcean belong to k8saas:authenticated.");
    for (const s of subjects.filter((x) => x.category !== "system")) {
      line(`- [${s.category}] ${s.label} | ${caps(s)} | via ${s.grants.map((g) => `${g.bindingKind} ${g.binding} -> ${g.roleKind} ${g.role}${g.missingRole ? " (role missing)" : ""}`).join(", ")}${s.kind === "ServiceAccount" ? ` | used by ${s.usedBy.join(", ") || "no running pod"}` : ""}`);
    }
    const system = subjects.filter((x) => x.category === "system");
    line(`System subjects (Kubernetes and DigitalOcean components): ${system.length}, of which ${system.filter((x) => x.severity === "critical").length} have admin-level access by design.`);
    line(`ServiceAccounts your pods run as with no permissions at all (cannot use the Kubernetes API): ${noAccess.map((n) => `${n.namespace}/${n.name} (used by ${n.usedBy.join(", ")})`).join("; ") || "none"}.`);
  } else {
    line(`\n## Access (RBAC)\nNot available: ${one(data.access.message)}`);
  }

  // ---- TLS certificates ----
  const certs = data.certificates;
  if (certs.state === "ok") {
    line(`\n## TLS certificates (cert-manager; dates UTC; certificate contents and private keys are not read)`);
    line("Health: critical when not ready, expired or expiring within 7 days; warning when expiring within 14 days or its renewal time passed more than a day ago without renewal.");
    if (certs.certificates.length === 0) line("(none)");
    for (const c of certs.certificates) {
      line(
        `- ${c.namespace}/${c.name} | ${c.state} (${c.health}) | hosts ${c.dnsNames.join(", ") || "none"} | issuer ${c.issuer.kind}/${c.issuer.name} | ready ${c.ready ? "yes" : `no${c.readyReason ? ` (${c.readyReason})` : ""}`}` +
          ` | expires ${c.notAfter ?? "not issued"}${c.daysLeft === null ? "" : ` (${c.daysLeft} days)`} | renews ${c.renewalTime ?? "?"}${c.daysToRenewal === null ? "" : ` (${c.daysToRenewal} days)`} | times issued ${c.revision ?? 0}` +
          ` | served by ${c.ingresses.map((i) => `ingress ${i.name}`).join(", ") || "no ingress"}${c.problem ? ` | problem: ${cut(one(c.problem), 200)}` : ""}`,
      );
    }
    line("### Issuers");
    for (const i of certs.issuers) line(`- ${i.kind} ${i.namespace ? `${i.namespace}/` : ""}${i.name} | ${i.type}${i.solvers.length ? ` (${i.solvers.join(", ")})` : ""} | ready ${i.ready ? "yes" : `no${i.reason ? ` (${i.reason})` : ""}`} | certificates ${i.certificates}`);
    line("### ACME challenges in progress");
    if (certs.challenges.length === 0) line("(none)");
    for (const ch of certs.challenges) line(`- ${ch.namespace}/${ch.name} | ${ch.dnsName} | ${ch.type} | ${ch.state}${ch.reason ? ` | ${cut(one(ch.reason), 200)}` : ""}`);
  } else {
    line(`\n## TLS certificates\n${certs.state === "not-installed" ? "cert-manager is not installed." : `Not available: ${one(certs.message)}`}`);
  }

  // ---- warning events ----
  line(`\n## Latest warning events (up to ${MAX_EVENTS})`);
  const events = data.namespaces
    .flatMap((ns) => buildEventViews(bundle.events, (e) => e.type === "Warning" && (e.metadata?.namespace ?? e.involvedObject?.namespace) === ns.name).map((e) => ({ ...e, namespace: ns.name })))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, MAX_EVENTS);
  if (events.length === 0) line("(none)");
  for (const e of events) line(`- ${e.namespace} | ${e.object ?? "?"} | ${e.reason} | ${cut(one(e.message), 200)} | seen ${e.count}x, last ${formatAge(e.lastSeen)} ago`);

  costSection(cost, line);

  line("\n## Not available to the assistant");
  line(
    "Environment variable values, Secrets and ConfigMaps, container logs, historical metrics (only the current moment), " +
      (cost?.state === "ok" ? "cost per namespace in the past (only the current rate), invoices older than those listed, " : "costs and billing, ") +
      "DigitalOcean resources outside this cluster other than their invoice lines, and anything that happened before the events above.",
  );

  return {
    text: out.join("\n"),
    generatedAt,
    counts: { nodes: data.nodes.length, namespaces: data.namespaces.length, pods: data.rows.length, services: services.length, ingresses: ingresses.length, pvcs: pvcs.length, helmReleases: data.helm.releases.length },
    index,
  };
}
