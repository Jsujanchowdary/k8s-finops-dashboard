// What the cluster costs per namespace right now, and where money is reserved but not used.
// Pure: built from the Kubernetes view models the dashboard already has, DigitalOcean's size prices and the invoice lines.
//
//   node price/h  = price_hourly of the node's size
//   CPU rate      = node price × 50% / vCPUs          (USD per core-hour)
//   memory rate   = node price × 50% / GiB            (USD per GiB-hour)
//   pod cost/h    = max(CPU request, CPU used) × CPU rate + max(memory request, memory used) × memory rate
//   namespace     = its pods + the volumes its claims are bound to
//   idle          = node price − all pod costs on the node (capacity paid for that no pod reserves or uses)
//   shared        = load balancers (they serve every namespace behind the ingress)
//
// Only billing data and the size price list are read from DigitalOcean: the Droplet, Volume and Load Balancer APIs
// are deliberately never called. Volumes and load balancers are matched to their invoice lines by name.
//
// A live estimate of the rate now, not a history: DigitalOcean bills the cluster as a whole.

import type { NodeView, PodRow, PvcView } from "@/lib/k8s/types";
import type { SizePrice } from "./parse";
import { HOURS_CAP, type LineCost } from "./spend";

export const CPU_SHARE = 0.5;
const GIB = 1024 ** 3;

export interface NodePrice {
  name: string;
  size?: string;
  /** USD per hour. Null when the node's size is not in DigitalOcean's price list. */
  hourly: number | null;
  cpuRate: number;
  memRate: number;
}

/** One pod's share of its node: what it is charged on and what that costs per hour. */
export interface PodCost {
  pod: string;
  node: string;
  cpuCores: number;
  memGib: number;
  /** Whether the pod is charged for what it requests or, being above it, what it uses. */
  cpuBasis: "request" | "usage";
  memBasis: "request" | "usage";
  cpu: number;
  memory: number;
  total: number;
  /** The node's rates it was priced at. */
  cpuRate: number;
  memRate: number;
}

export interface NamespaceCost {
  namespace: string;
  pods: number;
  cpu: number;
  memory: number;
  storage: number;
  /** USD per hour. */
  total: number;
  /** Requested but not used, USD per hour. Null without metrics. */
  unusedCpu: number | null;
  unusedMemory: number | null;
  volumes: number;
  /** Most expensive first. */
  podCosts: PodCost[];
  /** Each claim's volume and its rate from the invoice (0 when it has no invoice line yet). */
  volumeCosts: { claim: string; volume: string; hourly: number }[];
}

export interface SharedCost {
  name: string;
  /** "namespace/service" that owns it, when known. */
  owner?: string;
  hourly: number;
}

export interface Allocation {
  nodes: NodePrice[];
  namespaces: NamespaceCost[];
  idle: { cpu: number; memory: number; total: number };
  shared: SharedCost[];
  /** Volumes billed to the cluster that no claim is bound to. */
  unclaimedVolumes: SharedCost[];
  /** Claims whose volume has no invoice line yet (created after the invoice was generated). */
  unpricedClaims: string[];
  /** USD per hour: nodes + volumes + load balancers. */
  total: number;
  /** The same thing measured from the invoice: the hourly rates of the cluster's running lines. */
  invoiceRate: number;
  metricsAvailable: boolean;
  /** Pods that have no node yet, so they cost nothing. */
  unscheduledPods: number;
  /** Pods on a node whose size has no price. */
  unpricedPods: number;
  /** Pods reserve or use more than a node has, so the namespaces add up to more than the node price. */
  overcommitted: string[];
}

const isActive = (row: PodRow) => row.phase !== "Succeeded" && row.phase !== "Failed";

export function priceNodes(nodes: NodeView[], sizes: SizePrice[]): NodePrice[] {
  return nodes.map((node) => {
    const size = sizes.find((s) => s.slug === node.instanceType);
    if (!size || size.vcpus <= 0 || size.memoryMb <= 0) return { name: node.name, size: node.instanceType, hourly: null, cpuRate: 0, memRate: 0 };
    return {
      name: node.name,
      size: size.slug,
      hourly: size.priceHourly,
      cpuRate: (size.priceHourly * CPU_SHARE) / size.vcpus,
      memRate: (size.priceHourly * (1 - CPU_SHARE)) / (size.memoryMb / 1024),
    };
  });
}

/** "pvc-6c1a… (blr1) - 8.00GB Volume" -> "pvc-6c1a…" */
const volumeOf = (description: string) => /^(pvc-[0-9a-f-]{36})\b/i.exec(description)?.[1]?.toLowerCase();
/** "ac4cbf57… (blr1) (small) (nodes: 1) Public Load Balancer" -> "ac4cbf57…" */
const loadBalancerOf = (description: string) => (/load balancer/i.test(description) ? description.split(" ")[0] : undefined);
const hourlyOf = (line: LineCost | undefined) => (line?.running ? line.rate : 0);

/** A Service of type LoadBalancer, as the allocation needs it. */
export interface LoadBalancerService {
  namespace: string;
  name: string;
  uid: string;
  /** The `service.beta.kubernetes.io/do-loadbalancer-name` annotation, when set. */
  nameAnnotation?: string;
}

/**
 * The name DigitalOcean gives the load balancer of a Service: the annotation when set, otherwise
 * "a" + the Service's UID without dashes, cut to 32 characters (how the DigitalOcean cloud controller names it).
 */
export function loadBalancerName(svc: LoadBalancerService): string {
  return svc.nameAnnotation || `a${svc.uid.replace(/-/g, "")}`.slice(0, 32);
}

export function allocate(input: {
  nodes: NodeView[];
  rows: PodRow[];
  pvcs: PvcView[];
  loadBalancerServices: LoadBalancerService[];
  sizes: SizePrice[];
  /** Invoice lines of this cluster only. */
  clusterLines: LineCost[];
  metricsAvailable: boolean;
}): Allocation {
  const prices = priceNodes(input.nodes, input.sizes);
  const priceOf = new Map(prices.map((p) => [p.name, p]));
  const byNs = new Map<string, NamespaceCost>();
  const ns = (name: string): NamespaceCost => {
    let v = byNs.get(name);
    if (!v) {
      v = { namespace: name, pods: 0, cpu: 0, memory: 0, storage: 0, total: 0, unusedCpu: input.metricsAvailable ? 0 : null, unusedMemory: input.metricsAvailable ? 0 : null, volumes: 0, podCosts: [], volumeCosts: [] };
      byNs.set(name, v);
    }
    return v;
  };

  // ---- compute: pods on priced nodes ----
  const onNode = new Map<string, { cpu: number; memory: number }>();
  let unscheduledPods = 0;
  let unpricedPods = 0;
  for (const row of input.rows.filter(isActive)) {
    if (!row.nodeName) {
      unscheduledPods += 1;
      continue;
    }
    const price = priceOf.get(row.nodeName);
    if (!price || price.hourly === null) {
      unpricedPods += 1;
      continue;
    }
    const cpuCores = Math.max(row.cpu.request, row.cpu.usage ?? 0);
    const memGib = Math.max(row.memory.request, row.memory.usage ?? 0) / GIB;
    const cpu = cpuCores * price.cpuRate;
    const memory = memGib * price.memRate;
    const v = ns(row.namespace);
    v.podCosts.push({
      pod: row.name,
      node: row.nodeName,
      cpuCores,
      memGib,
      cpuBasis: (row.cpu.usage ?? 0) > row.cpu.request ? "usage" : "request",
      memBasis: (row.memory.usage ?? 0) > row.memory.request ? "usage" : "request",
      cpu,
      memory,
      total: cpu + memory,
      cpuRate: price.cpuRate,
      memRate: price.memRate,
    });
    v.pods += 1;
    v.cpu += cpu;
    v.memory += memory;
    if (v.unusedCpu !== null && row.cpu.usage !== null) v.unusedCpu += Math.max(0, row.cpu.request - row.cpu.usage) * price.cpuRate;
    if (v.unusedMemory !== null && row.memory.usage !== null) v.unusedMemory += (Math.max(0, row.memory.request - row.memory.usage) / GIB) * price.memRate;
    const n = onNode.get(row.nodeName) ?? { cpu: 0, memory: 0 };
    n.cpu += cpu;
    n.memory += memory;
    onNode.set(row.nodeName, n);
  }

  const idle = { cpu: 0, memory: 0, total: 0 };
  const overcommitted: string[] = [];
  for (const p of prices) {
    if (p.hourly === null) continue;
    const used = onNode.get(p.name) ?? { cpu: 0, memory: 0 };
    const cpuBudget = p.hourly * CPU_SHARE;
    const memBudget = p.hourly * (1 - CPU_SHARE);
    if (used.cpu > cpuBudget + 1e-9 || used.memory > memBudget + 1e-9) overcommitted.push(p.name);
    idle.cpu += Math.max(0, cpuBudget - used.cpu);
    idle.memory += Math.max(0, memBudget - used.memory);
  }
  idle.total = idle.cpu + idle.memory;

  // ---- storage: each claim's volume, matched to its invoice line by the volume name ----
  const volumeLines = new Map<string, LineCost>();
  for (const line of input.clusterLines) {
    const vol = volumeOf(line.description);
    if (vol) volumeLines.set(vol, line);
  }
  const claimed = new Set<string>();
  const unpricedClaims: string[] = [];
  for (const pvc of input.pvcs) {
    if (!pvc.volumeName) continue;
    const line = volumeLines.get(pvc.volumeName.toLowerCase());
    const v = ns(pvc.namespace);
    v.volumes += 1;
    v.volumeCosts.push({ claim: pvc.name, volume: pvc.volumeName, hourly: hourlyOf(line) });
    if (!line) {
      unpricedClaims.push(`${pvc.namespace}/${pvc.name}`);
      continue;
    }
    claimed.add(pvc.volumeName.toLowerCase());
    v.storage += hourlyOf(line);
  }
  const unclaimedVolumes = [...volumeLines.entries()]
    .filter(([vol, line]) => !claimed.has(vol) && line.running)
    .map(([vol, line]) => ({ name: vol, hourly: line.rate }));

  // ---- load balancers: shared; the owner is the Service the balancer is named after ----
  const shared: SharedCost[] = [];
  for (const line of input.clusterLines) {
    const name = loadBalancerOf(line.description);
    if (!name || !line.running) continue;
    const svc = input.loadBalancerServices.find((s) => loadBalancerName(s) === name);
    shared.push({ name, owner: svc ? `${svc.namespace}/${svc.name}` : undefined, hourly: line.rate });
  }

  for (const v of byNs.values()) {
    v.total = v.cpu + v.memory + v.storage;
    v.podCosts.sort((a, b) => b.total - a.total || a.pod.localeCompare(b.pod));
  }
  const nodeTotal = prices.reduce((a, p) => a + (p.hourly ?? 0), 0);
  const storageTotal = [...byNs.values()].reduce((a, v) => a + v.storage, 0) + unclaimedVolumes.reduce((a, v) => a + v.hourly, 0);
  const sharedTotal = shared.reduce((a, s) => a + s.hourly, 0);

  return {
    nodes: prices,
    namespaces: [...byNs.values()].filter((v) => v.total > 0 || v.pods > 0).sort((a, b) => b.total - a.total || a.namespace.localeCompare(b.namespace)),
    idle,
    shared,
    unclaimedVolumes,
    unpricedClaims,
    total: nodeTotal + storageTotal + sharedTotal,
    invoiceRate: input.clusterLines.filter((l) => l.running && !l.isTax).reduce((a, l) => a + l.rate, 0),
    metricsAvailable: input.metricsAvailable,
    unscheduledPods,
    unpricedPods,
    overcommitted,
  };
}

/** A resource that runs all month is billed 672 hours. */
export const monthly = (hourly: number) => hourly * HOURS_CAP;

export interface MissingRequests {
  namespace: string;
  pod: string;
  cpu: boolean;
  memory: boolean;
}

/** Running pods without a CPU or memory request: they use capacity the allocation cannot charge to them. */
export function podsWithoutRequests(rows: PodRow[]): MissingRequests[] {
  return rows
    .filter((r) => isActive(r) && r.nodeName && (r.cpu.request === 0 || r.memory.request === 0))
    .map((r) => ({ namespace: r.namespace, pod: r.name, cpu: r.cpu.request === 0, memory: r.memory.request === 0 }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.pod.localeCompare(b.pod));
}

export interface PoolCeiling {
  name: string;
  size: string;
  count: number;
  maxNodes: number;
  /** USD per month at today's node count, and at the autoscaler's maximum. Null when the size has no price. */
  nowMonthly: number | null;
  maxMonthly: number | null;
}

export function poolCeilings(pools: { name: string; size: string; count: number; autoScale: boolean; maxNodes?: number }[], sizes: SizePrice[]): PoolCeiling[] {
  return pools.map((pool) => {
    const price = sizes.find((s) => s.slug === pool.size)?.priceMonthly;
    const maxNodes = pool.autoScale && pool.maxNodes !== undefined ? pool.maxNodes : pool.count;
    return { name: pool.name, size: pool.size, count: pool.count, maxNodes, nowMonthly: price === undefined ? null : price * pool.count, maxMonthly: price === undefined ? null : price * maxNodes };
  });
}

export interface PricedThing {
  name: string;
  detail: string;
  /** USD per month if it keeps running. Null when no invoice line matches it yet. */
  monthly: number | null;
  /** This month so far. */
  amount: number | null;
  running: boolean;
}

/**
 * Droplets billed outside the cluster, read from the invoice ("server-001 (s-8vcpu-16gb)"), with their backups.
 * Kubernetes nodes are billed under the cluster, so they never appear here.
 */
export function otherDroplets(lines: LineCost[], sizes: SizePrice[]): (PricedThing & { backups: number | null })[] {
  return lines
    .filter((l) => l.product === "Droplets" && !l.groupDescription)
    .map((l) => {
      const match = /^(.+?) \(([^)]+)\)$/.exec(l.description);
      const name = match?.[1] ?? l.description;
      const slug = match?.[2] ?? "";
      const listPrice = sizes.find((s) => s.slug === slug)?.priceMonthly;
      const backups = lines.find((b) => b.product === "Droplet Backups" && b.description.startsWith(`${name} (`));
      return {
        name,
        detail: slug,
        monthly: listPrice ?? (l.rate > 0 ? monthly(l.rate) : null),
        amount: l.amount,
        running: l.running,
        backups: backups ? (backups.rate > 0 ? monthly(backups.rate) : backups.amount) : null,
      };
    })
    .sort((a, b) => (b.monthly ?? 0) - (a.monthly ?? 0));
}

/** Snapshots and backups: easy to forget, billed every month. */
export function snapshotsAndBackups(lines: LineCost[]): LineCost[] {
  return lines.filter((l) => /snapshot|backup/i.test(l.product)).sort((a, b) => b.projected - a.projected);
}
