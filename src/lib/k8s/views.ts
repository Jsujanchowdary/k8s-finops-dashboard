// Pure functions: raw Kubernetes objects in, serialisable view models out. No I/O here.
import type {
  CoreV1Event,
  NodeMetric,
  PodMetric,
  V1Container,
  V1ContainerState,
  V1ContainerStatus,
  V1DaemonSet,
  V1Deployment,
  V1Ingress,
  V1Namespace,
  V1Node,
  V1PersistentVolume,
  V1PersistentVolumeClaim,
  V1Pod,
  V1Probe,
  V1Service,
  V1StatefulSet,
} from "@kubernetes/client-node";
import { parseBytes, parseCpu } from "./quantity";
import { sanitizeAnnotations, sanitizePod } from "./sanitize";
import type {
  ConditionView,
  ContainerStateView,
  ContainerView,
  EnvFromView,
  EnvVarView,
  EventView,
  Health,
  IngressView,
  NamespaceView,
  NodeView,
  OwnerView,
  PodCounts,
  PodDetail,
  PodRow,
  ProbeView,
  PvcView,
  ResourceTriple,
  ServiceView,
  VolumeView,
  WorkloadView,
} from "./types";

export interface RawBundle {
  nodes: V1Node[];
  namespaces: V1Namespace[];
  pods: V1Pod[];
  services: V1Service[];
  ingresses: V1Ingress[];
  pvcs: V1PersistentVolumeClaim[];
  pvs: V1PersistentVolume[];
  deployments: V1Deployment[];
  statefulSets: V1StatefulSet[];
  daemonSets: V1DaemonSet[];
  events: CoreV1Event[];
  nodeMetrics: NodeMetric[] | null;
  podMetrics: PodMetric[] | null;
}

type DateLike = Date | string | undefined | null;

function toIso(value: DateLike): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const iso = (value: DateLike): string => toIso(value) ?? "";

// ---------------------------------------------------------------------------
// Pod status (modelled on kubectl's printer)
// ---------------------------------------------------------------------------

const CRITICAL_REASONS = new Set([
  "CrashLoopBackOff",
  "Error",
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
  "CreateContainerConfigError",
  "CreateContainerError",
  "RunContainerError",
  "OOMKilled",
  "Failed",
  "Evicted",
  "Unknown",
  "ContainerStatusUnknown",
  "DeadlineExceeded",
  "ImageInspectError",
  "ErrImageNeverPull",
]);

function isTerminalPhase(pod: V1Pod): boolean {
  return pod.status?.phase === "Succeeded" || pod.status?.phase === "Failed";
}

export function podStatus(pod: V1Pod): { status: string; health: Health } {
  const phase = pod.status?.phase ?? "Unknown";
  let reason: string = pod.status?.reason || phase;
  const init = pod.status?.initContainerStatuses ?? [];
  const initTotal = pod.spec?.initContainers?.length ?? 0;
  let initializing = false;

  for (let i = 0; i < init.length; i += 1) {
    const st = init[i].state;
    if (st?.terminated && st.terminated.exitCode === 0) continue;
    initializing = true;
    if (st?.terminated) {
      reason = `Init:${st.terminated.reason || (st.terminated.signal ? `Signal:${st.terminated.signal}` : `ExitCode:${st.terminated.exitCode}`)}`;
    } else if (st?.waiting?.reason && st.waiting.reason !== "PodInitializing") {
      reason = `Init:${st.waiting.reason}`;
    } else {
      reason = `Init:${i}/${initTotal}`;
    }
    break;
  }

  if (!initializing) {
    let hasRunning = false;
    const statuses = pod.status?.containerStatuses ?? [];
    for (let i = statuses.length - 1; i >= 0; i -= 1) {
      const st = statuses[i].state;
      if (st?.waiting?.reason) reason = st.waiting.reason;
      else if (st?.terminated?.reason) reason = st.terminated.reason;
      else if (st?.terminated) reason = st.terminated.signal ? `Signal:${st.terminated.signal}` : `ExitCode:${st.terminated.exitCode}`;
      else if (st?.running && statuses[i].ready) hasRunning = true;
    }
    if (reason === "Completed" && hasRunning) {
      const ready = (pod.status?.conditions ?? []).some((c) => c.type === "Ready" && c.status === "True");
      reason = ready ? "Running" : "NotReady";
    }
  }

  if (pod.metadata?.deletionTimestamp) reason = pod.status?.reason === "NodeLost" ? "Unknown" : "Terminating";

  if (phase === "Pending" && !pod.spec?.nodeName && reason === "Pending") {
    const scheduled = (pod.status?.conditions ?? []).find((c) => c.type === "PodScheduled" && c.status === "False");
    if (scheduled?.reason === "Unschedulable") reason = "Unschedulable";
  }

  return { status: reason, health: statusHealth(reason, phase, pod) };
}

function statusHealth(reason: string, phase: string, pod: V1Pod): Health {
  if (CRITICAL_REASONS.has(reason) || /^Init:(Error|CrashLoopBackOff|ErrImagePull|ImagePullBackOff|ExitCode|Signal)/.test(reason) || phase === "Failed") return "critical";
  if (reason === "Completed" || reason === "Succeeded") return "healthy";
  if (reason === "Running") {
    const statuses = pod.status?.containerStatuses ?? [];
    return statuses.every((s) => s.ready) ? "healthy" : "warning";
  }
  if (reason === "Unschedulable" || reason === "Pending" || reason === "ContainerCreating" || reason === "PodInitializing" || reason === "Terminating" || reason === "NotReady" || reason.startsWith("Init:")) return "warning";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

interface CpuMem {
  cpuRequest: number;
  cpuLimit: number;
  memRequest: number;
  memLimit: number;
}

/** Effective pod requests/limits: sum of containers, raised to the largest init container. */
export function podResourceTotals(pod: V1Pod): CpuMem {
  const sum = (containers: V1Container[] | undefined, key: "requests" | "limits", res: "cpu" | "memory") =>
    (containers ?? []).reduce((acc, c) => acc + (res === "cpu" ? parseCpu(c.resources?.[key]?.[res]) : parseBytes(c.resources?.[key]?.[res])), 0);
  const maxInit = (key: "requests" | "limits", res: "cpu" | "memory") =>
    Math.max(0, ...(pod.spec?.initContainers ?? []).map((c) => (res === "cpu" ? parseCpu(c.resources?.[key]?.[res]) : parseBytes(c.resources?.[key]?.[res]))));
  const containers = pod.spec?.containers;
  return {
    cpuRequest: Math.max(sum(containers, "requests", "cpu"), maxInit("requests", "cpu")),
    cpuLimit: Math.max(sum(containers, "limits", "cpu"), maxInit("limits", "cpu")),
    memRequest: Math.max(sum(containers, "requests", "memory"), maxInit("requests", "memory")),
    memLimit: Math.max(sum(containers, "limits", "memory"), maxInit("limits", "memory")),
  };
}

function metricsIndex(metrics: PodMetric[] | null) {
  if (!metrics) return null;
  const map = new Map<string, { cpu: number; memory: number; containers: Map<string, { cpu: number; memory: number }> }>();
  for (const m of metrics) {
    const containers = new Map<string, { cpu: number; memory: number }>();
    let cpu = 0;
    let memory = 0;
    for (const c of m.containers ?? []) {
      const cc = parseCpu(c.usage?.cpu);
      const cm = parseBytes(c.usage?.memory);
      containers.set(c.name, { cpu: cc, memory: cm });
      cpu += cc;
      memory += cm;
    }
    map.set(`${m.metadata.namespace}/${m.metadata.name}`, { cpu, memory, containers });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Pod rows
// ---------------------------------------------------------------------------

function inferOwner(pod: V1Pod): OwnerView | undefined {
  const ref = (pod.metadata?.ownerReferences ?? []).find((o) => o.controller) ?? pod.metadata?.ownerReferences?.[0];
  if (!ref) return undefined;
  if (ref.kind === "ReplicaSet") {
    const match = /^(.*)-[a-z0-9]{6,10}$/.exec(ref.name);
    if (match) return { kind: "Deployment", name: match[1], controller: !!ref.controller };
  }
  return { kind: ref.kind, name: ref.name, controller: !!ref.controller };
}

function releaseOf(meta: { labels?: Record<string, string>; annotations?: Record<string, string> } | undefined): string | undefined {
  return meta?.labels?.release || meta?.labels?.["app.kubernetes.io/instance"] || meta?.annotations?.["meta.helm.sh/release-name"] || undefined;
}

/** The git commit behind a pod: the `commit` label the charts set, else a hash at the end of the image tag. */
export function commitOf(pod: V1Pod): string | undefined {
  const label = pod.metadata?.labels?.commit;
  if (label && label !== "unknown") return label;
  const image = pod.spec?.containers?.[0]?.image ?? "";
  const tag = image.includes(":") ? image.slice(image.lastIndexOf(":") + 1) : "";
  const match = /(?:^|[-_])([0-9a-f]{7,40})$/i.exec(tag);
  return match ? match[1] : undefined;
}

export function buildPodRows(bundle: RawBundle): PodRow[] {
  const usage = metricsIndex(bundle.podMetrics);
  return bundle.pods.map((pod) => buildPodRow(pod, usage));
}

function buildPodRow(pod: V1Pod, usage: ReturnType<typeof metricsIndex>): PodRow {
  const { status, health } = podStatus(pod);
  const totals = podResourceTotals(pod);
  const key = `${pod.metadata?.namespace}/${pod.metadata?.name}`;
  const u = usage?.get(key);
  const statuses = pod.status?.containerStatuses ?? [];
  const total = pod.spec?.containers?.length ?? 0;
  const ready = statuses.filter((s) => s.ready).length;
  const restarts = [...statuses, ...(pod.status?.initContainerStatuses ?? [])].reduce((acc, s) => acc + (s.restartCount ?? 0), 0);
  return {
    name: pod.metadata?.name ?? "",
    namespace: pod.metadata?.namespace ?? "",
    status,
    phase: pod.status?.phase ?? "Unknown",
    health,
    ready: `${ready}/${total}`,
    restarts,
    nodeName: pod.spec?.nodeName,
    podIp: pod.status?.podIP,
    createdAt: iso(pod.metadata?.creationTimestamp),
    owner: inferOwner(pod),
    release: releaseOf(pod.metadata),
    commit: commitOf(pod),
    qos: pod.status?.qosClass,
    images: (pod.spec?.containers ?? []).map((c) => c.image ?? ""),
    cpu: { request: totals.cpuRequest, limit: totals.cpuLimit, usage: u ? u.cpu : null },
    memory: { request: totals.memRequest, limit: totals.memLimit, usage: u ? u.memory : null },
  };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// "True" is bad for some conditions (MemoryPressure) and good for others (Ready, CiliumAgentReady).
const BAD_WHEN_TRUE = /(pressure|unavailable|problem|deadlock|corrupt|readonly|failure|failed|unhealthy|error|oom)/i;
const GOOD_WHEN_TRUE = /(ready|healthy|ok|available)$/i;

/** Judges one node condition. Unrecognised custom conditions are "unknown" (neutral), never flagged. */
export function conditionHealth(type: string, status: string): Health {
  if (status !== "True" && status !== "False") return "warning"; // Unknown
  const name = type.split("/").pop() ?? type; // drop a domain prefix such as doks.kubernetes.io/
  if (BAD_WHEN_TRUE.test(name)) return status === "True" ? "critical" : "healthy";
  if (GOOD_WHEN_TRUE.test(name)) return status === "True" ? "healthy" : "critical";
  return "unknown";
}

export function buildNodeViews(bundle: RawBundle): NodeView[] {
  const usage = new Map((bundle.nodeMetrics ?? []).map((m) => [m.metadata.name, m.usage]));
  return bundle.nodes
    .map((node) => {
      const name = node.metadata?.name ?? "";
      const labels = node.metadata?.labels ?? {};
      const onNode = bundle.pods.filter((p) => p.spec?.nodeName === name && !isTerminalPhase(p));
      const totals = onNode.map(podResourceTotals);
      const sum = (pick: (t: CpuMem) => number) => totals.reduce((acc, t) => acc + pick(t), 0);
      const ready = (node.status?.conditions ?? []).some((c) => c.type === "Ready" && c.status === "True");
      const u = usage.get(name);
      const addr = (type: string) => node.status?.addresses?.find((a) => a.type === type)?.address;
      const info = node.status?.nodeInfo;
      const roles = Object.keys(labels)
        .filter((k) => k.startsWith("node-role.kubernetes.io/"))
        .map((k) => k.slice("node-role.kubernetes.io/".length));
      const unschedulable = !!node.spec?.unschedulable;
      return {
        name,
        ready,
        status: `${ready ? "Ready" : "NotReady"}${unschedulable ? ",SchedulingDisabled" : ""}`,
        roles,
        instanceType: labels["node.kubernetes.io/instance-type"] ?? labels["beta.kubernetes.io/instance-type"],
        region: labels["topology.kubernetes.io/region"] ?? labels["failure-domain.beta.kubernetes.io/region"],
        zone: labels["topology.kubernetes.io/zone"],
        nodePool: labels["doks.digitalocean.com/node-pool"] ?? labels["eks.amazonaws.com/nodegroup"] ?? labels["cloud.google.com/gke-nodepool"],
        providerId: node.spec?.providerID,
        kubeletVersion: info?.kubeletVersion ?? "",
        osImage: info?.osImage ?? "",
        kernelVersion: info?.kernelVersion ?? "",
        containerRuntime: info?.containerRuntimeVersion ?? "",
        architecture: info?.architecture ?? "",
        internalIp: addr("InternalIP"),
        externalIp: addr("ExternalIP"),
        createdAt: iso(node.metadata?.creationTimestamp),
        unschedulable,
        cpu: {
          capacity: parseCpu(node.status?.capacity?.cpu),
          allocatable: parseCpu(node.status?.allocatable?.cpu),
          requests: sum((t) => t.cpuRequest),
          limits: sum((t) => t.cpuLimit),
          usage: u ? parseCpu(u.cpu) : null,
        },
        memory: {
          capacity: parseBytes(node.status?.capacity?.memory),
          allocatable: parseBytes(node.status?.allocatable?.memory),
          requests: sum((t) => t.memRequest),
          limits: sum((t) => t.memLimit),
          usage: u ? parseBytes(u.memory) : null,
        },
        pods: { count: onNode.length, capacity: Number(node.status?.allocatable?.pods ?? node.status?.capacity?.pods ?? 0) },
        conditions: (node.status?.conditions ?? []).map((c) => ({ type: c.type, status: c.status, health: conditionHealth(c.type, c.status), reason: c.reason, message: c.message })),
        taints: (node.spec?.taints ?? []).map((t) => `${t.key}${t.value ? `=${t.value}` : ""}:${t.effect}`),
        labels,
      } satisfies NodeView;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

function emptyCounts(): PodCounts {
  return { total: 0, running: 0, pending: 0, failed: 0, succeeded: 0, unhealthy: 0 };
}

const DAY_MS = 24 * 3_600_000;

export function buildNamespaceViews(bundle: RawBundle, rows: PodRow[], now: number = Date.now()): NamespaceView[] {
  const byNs = new Map<string, NamespaceView>();
  const ensure = (name: string, phase = "Active", createdAt = ""): NamespaceView => {
    let view = byNs.get(name);
    if (!view) {
      view = {
        name,
        phase,
        createdAt,
        health: "unknown",
        pods: emptyCounts(),
        restarts: 0,
        cpu: { request: 0, limit: 0, usage: bundle.podMetrics ? 0 : null },
        memory: { request: 0, limit: 0, usage: bundle.podMetrics ? 0 : null },
        counts: { deployments: 0, statefulsets: 0, daemonsets: 0, services: 0, ingresses: 0, pvcs: 0 },
        storageBytes: 0,
        warningEvents: 0,
        hosts: [],
      };
      byNs.set(name, view);
    }
    return view;
  };

  for (const ns of bundle.namespaces) ensure(ns.metadata?.name ?? "", ns.status?.phase ?? "Active", iso(ns.metadata?.creationTimestamp));

  for (const row of rows) {
    const v = ensure(row.namespace);
    v.pods.total += 1;
    if (row.phase === "Running") v.pods.running += 1;
    else if (row.phase === "Pending") v.pods.pending += 1;
    else if (row.phase === "Failed") v.pods.failed += 1;
    else if (row.phase === "Succeeded") v.pods.succeeded += 1;
    if (row.health === "critical" || row.health === "warning") v.pods.unhealthy += 1;
    v.restarts += row.restarts;
    if (row.phase !== "Succeeded" && row.phase !== "Failed") {
      v.cpu.request += row.cpu.request;
      v.cpu.limit += row.cpu.limit;
      v.memory.request += row.memory.request;
      v.memory.limit += row.memory.limit;
    }
    if (v.cpu.usage !== null && row.cpu.usage !== null) v.cpu.usage += row.cpu.usage;
    if (v.memory.usage !== null && row.memory.usage !== null) v.memory.usage += row.memory.usage;
  }

  const count = (items: { metadata?: { namespace?: string } }[], field: keyof NamespaceView["counts"]) => {
    for (const item of items) if (item.metadata?.namespace) ensure(item.metadata.namespace).counts[field] += 1;
  };
  count(bundle.deployments, "deployments");
  count(bundle.statefulSets, "statefulsets");
  count(bundle.daemonSets, "daemonsets");
  count(bundle.services, "services");
  count(bundle.ingresses, "ingresses");
  count(bundle.pvcs, "pvcs");

  for (const pvc of bundle.pvcs) {
    if (pvc.metadata?.namespace) ensure(pvc.metadata.namespace).storageBytes += parseBytes(pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage);
  }
  for (const ing of bundle.ingresses) {
    if (!ing.metadata?.namespace) continue;
    const hosts = (ing.spec?.rules ?? []).map((r) => r.host).filter((h): h is string => !!h);
    const v = ensure(ing.metadata.namespace);
    for (const h of hosts) if (!v.hosts.includes(h)) v.hosts.push(h);
  }
  for (const ev of bundle.events) {
    if (ev.type !== "Warning" || !ev.metadata?.namespace) continue;
    const last = eventTime(ev);
    if (last && now - new Date(last).getTime() <= DAY_MS) ensure(ev.metadata.namespace).warningEvents += 1;
  }

  for (const v of byNs.values()) {
    const critical = rows.some((r) => r.namespace === v.name && r.health === "critical");
    const warning = rows.some((r) => r.namespace === v.name && r.health === "warning");
    v.health = v.pods.total === 0 ? "unknown" : critical ? "critical" : warning ? "warning" : "healthy";
  }

  return [...byNs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Workloads, services, ingresses, storage, events
// ---------------------------------------------------------------------------

export function buildWorkloads(bundle: RawBundle, namespace?: string): WorkloadView[] {
  const inNs = <T extends { metadata?: { namespace?: string } }>(items: T[]) => items.filter((i) => !namespace || i.metadata?.namespace === namespace);
  const images = (t: { spec?: { template?: { spec?: { containers?: V1Container[] } } } }) => (t.spec?.template?.spec?.containers ?? []).map((c) => c.image ?? "");
  const health = (ready: number, desired: number): Health => (desired === 0 ? "unknown" : ready >= desired ? "healthy" : ready === 0 ? "critical" : "warning");
  const out: WorkloadView[] = [];
  for (const d of inNs(bundle.deployments)) {
    const desired = d.spec?.replicas ?? 1;
    const ready = d.status?.readyReplicas ?? 0;
    out.push({ kind: "Deployment", name: d.metadata?.name ?? "", namespace: d.metadata?.namespace ?? "", ready: `${ready}/${desired}`, health: health(ready, desired), images: images(d), createdAt: iso(d.metadata?.creationTimestamp), strategy: d.spec?.strategy?.type, release: releaseOf(d.metadata), helmRelease: d.metadata?.annotations?.["meta.helm.sh/release-name"] });
  }
  for (const s of inNs(bundle.statefulSets)) {
    const desired = s.spec?.replicas ?? 1;
    const ready = s.status?.readyReplicas ?? 0;
    out.push({ kind: "StatefulSet", name: s.metadata?.name ?? "", namespace: s.metadata?.namespace ?? "", ready: `${ready}/${desired}`, health: health(ready, desired), images: images(s), createdAt: iso(s.metadata?.creationTimestamp), release: releaseOf(s.metadata), helmRelease: s.metadata?.annotations?.["meta.helm.sh/release-name"] });
  }
  for (const d of inNs(bundle.daemonSets)) {
    const desired = d.status?.desiredNumberScheduled ?? 0;
    const ready = d.status?.numberReady ?? 0;
    out.push({ kind: "DaemonSet", name: d.metadata?.name ?? "", namespace: d.metadata?.namespace ?? "", ready: `${ready}/${desired}`, health: health(ready, desired), images: images(d), createdAt: iso(d.metadata?.creationTimestamp), release: releaseOf(d.metadata), helmRelease: d.metadata?.annotations?.["meta.helm.sh/release-name"] });
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

export function buildIngressViews(bundle: RawBundle, namespace?: string): IngressView[] {
  return bundle.ingresses
    .filter((i) => !namespace || i.metadata?.namespace === namespace)
    .map((ing) => {
      const rules = (ing.spec?.rules ?? []).flatMap((rule) =>
        (rule.http?.paths ?? []).map((p) => ({
          host: rule.host,
          path: p.path ?? "/",
          pathType: p.pathType,
          serviceName: p.backend?.service?.name ?? "",
          servicePort: String(p.backend?.service?.port?.number ?? p.backend?.service?.port?.name ?? ""),
        })),
      );
      return {
        name: ing.metadata?.name ?? "",
        namespace: ing.metadata?.namespace ?? "",
        className: ing.spec?.ingressClassName,
        hosts: [...new Set((ing.spec?.rules ?? []).map((r) => r.host).filter((h): h is string => !!h))],
        rules,
        tls: (ing.spec?.tls ?? []).map((t) => ({ hosts: t.hosts ?? [], secretName: t.secretName })),
        address: (ing.status?.loadBalancer?.ingress ?? []).map((i) => i.ip ?? i.hostname ?? "").filter(Boolean),
        createdAt: iso(ing.metadata?.creationTimestamp),
      } satisfies IngressView;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildServiceViews(bundle: RawBundle, namespace?: string): ServiceView[] {
  const ingresses = buildIngressViews(bundle, namespace);
  return bundle.services
    .filter((s) => !namespace || s.metadata?.namespace === namespace)
    .map((svc) => {
      const ns = svc.metadata?.namespace ?? "";
      const name = svc.metadata?.name ?? "";
      return {
        name,
        namespace: ns,
        type: svc.spec?.type ?? "ClusterIP",
        clusterIp: svc.spec?.clusterIP,
        externalIps: svc.spec?.externalIPs ?? [],
        loadBalancer: (svc.status?.loadBalancer?.ingress ?? []).map((i) => i.ip ?? i.hostname ?? "").filter(Boolean),
        ports: (svc.spec?.ports ?? []).map((p) => ({ name: p.name, port: p.port, targetPort: String(p.targetPort ?? p.port), protocol: p.protocol ?? "TCP", nodePort: p.nodePort })),
        selector: svc.spec?.selector ?? {},
        createdAt: iso(svc.metadata?.creationTimestamp),
        ingresses: ingresses.filter((i) => i.namespace === ns && i.rules.some((r) => r.serviceName === name)),
      } satisfies ServiceView;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildPvcViews(bundle: RawBundle, namespace?: string): PvcView[] {
  const claimsUsedBy = new Map<string, string[]>();
  for (const pod of bundle.pods) {
    for (const vol of pod.spec?.volumes ?? []) {
      const claim = vol.persistentVolumeClaim?.claimName;
      if (!claim) continue;
      const key = `${pod.metadata?.namespace}/${claim}`;
      claimsUsedBy.set(key, [...(claimsUsedBy.get(key) ?? []), pod.metadata?.name ?? ""]);
    }
  }
  return bundle.pvcs
    .filter((c) => !namespace || c.metadata?.namespace === namespace)
    .map((c) => ({
      name: c.metadata?.name ?? "",
      namespace: c.metadata?.namespace ?? "",
      status: c.status?.phase ?? "Unknown",
      storageClass: c.spec?.storageClassName,
      requestedBytes: parseBytes(c.spec?.resources?.requests?.storage),
      capacityBytes: parseBytes(c.status?.capacity?.storage),
      accessModes: c.status?.accessModes ?? c.spec?.accessModes ?? [],
      volumeName: c.spec?.volumeName,
      volumeMode: c.spec?.volumeMode,
      createdAt: iso(c.metadata?.creationTimestamp),
      usedBy: claimsUsedBy.get(`${c.metadata?.namespace}/${c.metadata?.name}`) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function eventTime(ev: CoreV1Event): string | undefined {
  return toIso(ev.lastTimestamp) ?? toIso(ev.eventTime as DateLike) ?? toIso(ev.series?.lastObservedTime as DateLike) ?? toIso(ev.firstTimestamp) ?? toIso(ev.metadata?.creationTimestamp);
}

export function buildEventViews(events: CoreV1Event[], filter: (ev: CoreV1Event) => boolean): EventView[] {
  return events
    .filter(filter)
    .map((ev) => ({
      type: ev.type ?? "Normal",
      reason: ev.reason ?? "",
      message: ev.message ?? "",
      count: ev.count ?? ev.series?.count ?? 1,
      firstSeen: toIso(ev.firstTimestamp),
      lastSeen: eventTime(ev) ?? "",
      source: ev.source?.component ?? ev.reportingComponent,
      object: ev.involvedObject ? `${(ev.involvedObject.kind ?? "").toLowerCase()}/${ev.involvedObject.name}` : undefined,
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

// ---------------------------------------------------------------------------
// Pod detail
// ---------------------------------------------------------------------------

function stateView(state: V1ContainerState | undefined): ContainerStateView {
  if (state?.running) return { kind: "running", startedAt: toIso(state.running.startedAt) };
  if (state?.waiting) return { kind: "waiting", reason: state.waiting.reason, message: state.waiting.message };
  if (state?.terminated) {
    const t = state.terminated;
    return { kind: "terminated", reason: t.reason, message: t.message, exitCode: t.exitCode, signal: t.signal, startedAt: toIso(t.startedAt), finishedAt: toIso(t.finishedAt) };
  }
  return { kind: "unknown" };
}

function probeView(kind: ProbeView["kind"], probe: V1Probe | undefined): ProbeView | undefined {
  if (!probe) return undefined;
  const base = { kind, initialDelaySeconds: probe.initialDelaySeconds, periodSeconds: probe.periodSeconds, timeoutSeconds: probe.timeoutSeconds, successThreshold: probe.successThreshold, failureThreshold: probe.failureThreshold };
  if (probe.httpGet) return { ...base, type: "http", target: `${probe.httpGet.scheme ?? "HTTP"} :${probe.httpGet.port}${probe.httpGet.path ?? "/"}` };
  if (probe.tcpSocket) return { ...base, type: "tcp", target: `:${probe.tcpSocket.port}` };
  if (probe.grpc) return { ...base, type: "grpc", target: `:${probe.grpc.port}` };
  if (probe.exec) return { ...base, type: "exec", target: (probe.exec.command ?? []).join(" ") };
  return { ...base, type: "unknown", target: "" };
}

function envViews(container: V1Container): EnvVarView[] {
  return (container.env ?? []).map((e): EnvVarView => {
    const from = e.valueFrom;
    if (from?.secretKeyRef) return { name: e.name, source: "secret", ref: `${from.secretKeyRef.name}/${from.secretKeyRef.key}` };
    if (from?.configMapKeyRef) return { name: e.name, source: "configmap", ref: `${from.configMapKeyRef.name}/${from.configMapKeyRef.key}` };
    if (from?.fieldRef) return { name: e.name, source: "field", ref: from.fieldRef.fieldPath };
    if (from?.resourceFieldRef) return { name: e.name, source: "resource", ref: from.resourceFieldRef.resource };
    return { name: e.name, source: "literal", value: e.value ?? "" };
  });
}

function envFromViews(container: V1Container): EnvFromView[] {
  return (container.envFrom ?? []).flatMap((e): EnvFromView[] => {
    if (e.secretRef) return [{ kind: "secret", name: e.secretRef.name ?? "", prefix: e.prefix, optional: e.secretRef.optional }];
    if (e.configMapRef) return [{ kind: "configmap", name: e.configMapRef.name ?? "", prefix: e.prefix, optional: e.configMapRef.optional }];
    return [];
  });
}

function volumeViews(pod: V1Pod, pvcs: PvcView[]): VolumeView[] {
  return (pod.spec?.volumes ?? []).map((v): VolumeView => {
    if (v.persistentVolumeClaim) {
      const claim = v.persistentVolumeClaim.claimName;
      return { name: v.name, type: "pvc", source: claim, detail: v.persistentVolumeClaim.readOnly ? "read-only" : undefined, pvc: pvcs.find((p) => p.name === claim && p.namespace === pod.metadata?.namespace) };
    }
    if (v.secret) return { name: v.name, type: "secret", source: v.secret.secretName ?? "" };
    if (v.configMap) return { name: v.name, type: "configmap", source: v.configMap.name ?? "" };
    if (v.emptyDir) return { name: v.name, type: "emptyDir", source: "emptyDir", detail: v.emptyDir.medium || v.emptyDir.sizeLimit ? [v.emptyDir.medium, v.emptyDir.sizeLimit].filter(Boolean).join(" ") : undefined };
    if (v.projected) return { name: v.name, type: "projected", source: "projected", detail: `${v.projected.sources?.length ?? 0} sources` };
    if (v.hostPath) return { name: v.name, type: "hostPath", source: v.hostPath.path };
    if (v.downwardAPI) return { name: v.name, type: "downwardAPI", source: "downwardAPI" };
    return { name: v.name, type: "other", source: "" };
  });
}

function containerViews(pod: V1Pod, usage: ReturnType<typeof metricsIndex>): ContainerView[] {
  const podUsage = usage?.get(`${pod.metadata?.namespace}/${pod.metadata?.name}`);
  const make = (container: V1Container, status: V1ContainerStatus | undefined, isInit: boolean): ContainerView => {
    const u = podUsage?.containers.get(container.name);
    const resources = container.resources ?? {};
    return {
      name: container.name,
      isInit,
      image: container.image ?? "",
      imagePullPolicy: container.imagePullPolicy,
      imageId: status?.imageID,
      containerId: status?.containerID,
      command: container.command,
      args: container.args,
      state: stateView(status?.state),
      lastState: status?.lastState && Object.keys(status.lastState).length ? stateView(status.lastState) : undefined,
      ready: !!status?.ready,
      started: status?.started,
      restartCount: status?.restartCount ?? 0,
      ports: (container.ports ?? []).map((p) => ({ name: p.name, containerPort: p.containerPort, protocol: p.protocol ?? "TCP", hostPort: p.hostPort })),
      resources: {
        cpu: { request: parseCpu(resources.requests?.cpu), limit: parseCpu(resources.limits?.cpu), usage: u ? u.cpu : null },
        memory: { request: parseBytes(resources.requests?.memory), limit: parseBytes(resources.limits?.memory), usage: u ? u.memory : null },
        requestsRaw: { ...(resources.requests ?? {}) },
        limitsRaw: { ...(resources.limits ?? {}) },
      },
      env: envViews(container),
      envFrom: envFromViews(container),
      mounts: (container.volumeMounts ?? []).map((m) => ({ name: m.name, mountPath: m.mountPath, readOnly: !!m.readOnly, subPath: m.subPath })),
      probes: [probeView("liveness", container.livenessProbe), probeView("readiness", container.readinessProbe), probeView("startup", container.startupProbe)].filter((p): p is ProbeView => !!p),
      securityContext: container.securityContext ? JSON.parse(JSON.stringify(container.securityContext)) : undefined,
    };
  };
  const initStatuses = new Map((pod.status?.initContainerStatuses ?? []).map((s) => [s.name, s]));
  const statuses = new Map((pod.status?.containerStatuses ?? []).map((s) => [s.name, s]));
  return [
    ...(pod.spec?.initContainers ?? []).map((c) => make(c, initStatuses.get(c.name), true)),
    ...(pod.spec?.containers ?? []).map((c) => make(c, statuses.get(c.name), false)),
  ];
}

function selectorMatches(selector: Record<string, string> | undefined, labels: Record<string, string>): boolean {
  const entries = Object.entries(selector ?? {});
  return entries.length > 0 && entries.every(([k, v]) => labels[k] === v);
}

function findPod(bundle: RawBundle, namespace: string, name: string): V1Pod | undefined {
  return bundle.pods.find((p) => p.metadata?.namespace === namespace && p.metadata?.name === name);
}

export function buildPodDetail(bundle: RawBundle, namespace: string, name: string): PodDetail | null {
  const pod = findPod(bundle, namespace, name);
  if (!pod) return null;
  const usage = metricsIndex(bundle.podMetrics);
  const row = buildPodRow(pod, usage);
  const labels = pod.metadata?.labels ?? {};
  const pvcViews = buildPvcViews(bundle, namespace);
  const containers = containerViews(pod, usage);

  const services = buildServiceViews(bundle, namespace).filter((s) => selectorMatches(s.selector, labels));
  const ports = (pod.spec?.containers ?? []).flatMap((c) => (c.ports ?? []).map((p) => ({ container: c.name, name: p.name, port: p.containerPort, protocol: p.protocol ?? "TCP" })));

  const owners: OwnerView[] = (pod.metadata?.ownerReferences ?? []).map((o) => ({ kind: o.kind, name: o.name, controller: !!o.controller }));
  const inferred = inferOwner(pod);
  if (inferred && inferred.kind === "Deployment") owners.push({ ...inferred, controller: false });

  const conditions: ConditionView[] = (pod.status?.conditions ?? []).map((c) => ({ type: c.type, status: c.status, reason: c.reason, message: c.message, lastTransition: toIso(c.lastTransitionTime) }));

  return {
    row,
    uid: pod.metadata?.uid,
    labels,
    annotations: sanitizeAnnotations(pod.metadata?.annotations),
    owners,
    conditions,
    containers,
    volumes: volumeViews(pod, pvcViews),
    network: {
      podIp: pod.status?.podIP,
      podIps: (pod.status?.podIPs ?? []).map((p) => p.ip ?? ""),
      hostIp: pod.status?.hostIP,
      hostNetwork: !!pod.spec?.hostNetwork,
      dnsPolicy: pod.spec?.dnsPolicy,
      hostname: pod.spec?.hostname,
      subdomain: pod.spec?.subdomain,
      ports,
      services,
    },
    scheduling: {
      nodeName: pod.spec?.nodeName,
      nodeSelector: pod.spec?.nodeSelector ?? {},
      tolerations: (pod.spec?.tolerations ?? []).map((t) => ({ key: t.key, operator: t.operator, value: t.value, effect: t.effect, tolerationSeconds: t.tolerationSeconds })),
      affinity: pod.spec?.affinity ? JSON.parse(JSON.stringify(pod.spec.affinity)) : undefined,
      priorityClass: pod.spec?.priorityClassName,
      priority: pod.spec?.priority,
      schedulerName: pod.spec?.schedulerName,
      restartPolicy: pod.spec?.restartPolicy,
      terminationGracePeriodSeconds: pod.spec?.terminationGracePeriodSeconds,
    },
    security: {
      serviceAccount: pod.spec?.serviceAccountName,
      imagePullSecrets: (pod.spec?.imagePullSecrets ?? []).map((s) => s.name ?? ""),
      podSecurityContext: pod.spec?.securityContext ? JSON.parse(JSON.stringify(pod.spec.securityContext)) : undefined,
    },
    events: buildEventViews(bundle.events, (ev) => ev.involvedObject?.kind === "Pod" && ev.involvedObject.name === name && (ev.involvedObject.namespace ?? ev.metadata?.namespace) === namespace),
    raw: sanitizePod(pod),
  };
}

export function resourceTotals(rows: PodRow[]): { cpu: ResourceTriple; memory: ResourceTriple } {
  const cpu: ResourceTriple = { request: 0, limit: 0, usage: null };
  const memory: ResourceTriple = { request: 0, limit: 0, usage: null };
  for (const r of rows) {
    cpu.request += r.cpu.request;
    cpu.limit += r.cpu.limit;
    memory.request += r.memory.request;
    memory.limit += r.memory.limit;
    // Pods without metrics (for example Pending) add nothing; usage stays null only if no pod has metrics.
    if (r.cpu.usage !== null) cpu.usage = (cpu.usage ?? 0) + r.cpu.usage;
    if (r.memory.usage !== null) memory.usage = (memory.usage ?? 0) + r.memory.usage;
  }
  return { cpu, memory };
}
