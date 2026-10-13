// Turns the cluster objects already loaded for the dashboard into the architecture diagram of one namespace.
// Pure: no I/O, no new Kubernetes calls. Secrets and ConfigMaps are never read, so a link that is only defined
// inside one of them cannot be drawn; the diagram says so instead of guessing.

import type { V1Container, V1LabelSelector, V1Pod, V1Service } from "@kubernetes/client-node";
import { buildWorkloads, type RawBundle } from "@/lib/k8s/views";
import type { Health, PodRow, WorkloadView } from "@/lib/k8s/types";
import { bareHost, extractEndpoints, isLocalHost, serviceFromHost } from "./endpoints";
import type { EdgeKind, TopoEdge, TopoFact, TopoNode, TopoPod, Topology } from "./types";

const key = (namespace: string, name: string) => `${namespace}/${name}`;
const podIdOf = (namespace: string, name: string) => `pod:${namespace}/${name}`;
const svcIdOf = (namespace: string, name: string) => `svc:${namespace}/${name}`;
const nsHref = (namespace: string) => `/namespaces/${encodeURIComponent(namespace)}`;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function selectorMatches(selector: V1LabelSelector | undefined, labels: Record<string, string> | undefined): boolean {
  const matchLabels = selector?.matchLabels ?? {};
  const expressions = selector?.matchExpressions ?? [];
  if (Object.keys(matchLabels).length === 0 && expressions.length === 0) return false;
  for (const [k, v] of Object.entries(matchLabels)) if (labels?.[k] !== v) return false;
  for (const e of expressions) {
    const actual = labels?.[e.key];
    const values = e.values ?? [];
    if (e.operator === "In" && !(actual !== undefined && values.includes(actual))) return false;
    if (e.operator === "NotIn" && actual !== undefined && values.includes(actual)) return false;
    if (e.operator === "Exists" && actual === undefined) return false;
    if (e.operator === "DoesNotExist" && actual !== undefined) return false;
  }
  return true;
}

export function serviceSelects(svc: V1Service, pod: V1Pod): boolean {
  const selector = svc.spec?.selector;
  if (!selector || Object.keys(selector).length === 0) return false;
  return Object.entries(selector).every(([k, v]) => pod.metadata?.labels?.[k] === v);
}

export function podReady(pod: V1Pod): boolean {
  if (pod.metadata?.deletionTimestamp) return false;
  return (pod.status?.conditions ?? []).some((c) => c.type === "Ready" && c.status === "True");
}

/** Healthy when every pod is ready, critical when none is, warning in between. */
function readiness(total: number, ready: number): Health {
  if (total === 0) return "critical";
  return ready === total ? "healthy" : ready === 0 ? "critical" : "warning";
}

function rollUp(health: Health[]): Health {
  if (health.length === 0) return "unknown";
  if (health.every((h) => h === "healthy")) return "healthy";
  if (health.every((h) => h === "critical")) return "critical";
  return "warning";
}

/** `ghcr.io/org/app:tag@sha256:…` becomes `org/app:tag`: the registry host and the digest are noise in a diagram. */
function shortImage(image: string): string {
  const parts = image.replace(/@sha256:[0-9a-f]+$/i, "").split("/");
  return parts.length > 1 && /[.:]/.test(parts[0]) ? parts.slice(1).join("/") : image;
}

function portsText(ports: { port: number; protocol?: string }[]): string {
  return ports.map((p) => p.port).join(", ");
}

// ---------------------------------------------------------------------------
// Which workload does a pod belong to
// ---------------------------------------------------------------------------

interface Group {
  id: string;
  kind: string;
  name: string;
  view?: WorkloadView;
  pods: V1Pod[];
  containers: V1Container[];
}

function groupKeyOf(pod: V1Pod, deployments: { name: string; selector?: V1LabelSelector }[]): { kind: string; name: string } {
  const ref = (pod.metadata?.ownerReferences ?? []).find((o) => o.controller) ?? pod.metadata?.ownerReferences?.[0];
  if (!ref) return { kind: "Pod", name: pod.metadata?.name ?? "" };
  if (ref.kind === "ReplicaSet") {
    const deployment = deployments.find((d) => selectorMatches(d.selector, pod.metadata?.labels));
    if (deployment) return { kind: "Deployment", name: deployment.name };
    const hash = /^(.*)-[a-z0-9]{6,10}$/.exec(ref.name);
    return hash ? { kind: "Deployment", name: hash[1] } : { kind: "ReplicaSet", name: ref.name };
  }
  return { kind: ref.kind, name: ref.name };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildTopology(bundle: RawBundle, rows: PodRow[], namespace: string): Topology {
  const nodes = new Map<string, TopoNode>();
  const edges = new Map<string, TopoEdge>();
  const notes: string[] = [];

  const rowByPod = new Map(rows.map((r) => [key(r.namespace, r.name), r]));
  const addNode = (node: TopoNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return node.id;
  };
  const addEdge = (from: string, to: string, kind: EdgeKind, extra: { toPod?: string; label?: string; active?: boolean } = {}) => {
    const id = `${kind}:${from}>${extra.toPod ?? to}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, toPod: extra.toPod, kind, label: extra.label, active: extra.active ?? true });
  };

  // ---- pods and workloads -------------------------------------------------
  const nsPods = bundle.pods.filter((p) => p.metadata?.namespace === namespace);
  const livePods = nsPods.filter((p) => p.status?.phase !== "Succeeded");
  const completed = nsPods.length - livePods.length;
  if (completed > 0) notes.push(`${completed} completed pod${completed === 1 ? " is" : "s are"} not drawn.`);

  const inNs = <T extends { metadata?: { namespace?: string } }>(items: T[]) => items.filter((i) => i.metadata?.namespace === namespace);
  const deployments = inNs(bundle.deployments);
  const deploymentRefs = deployments.map((d) => ({ name: d.metadata?.name ?? "", selector: d.spec?.selector }));

  const groups = new Map<string, Group>();
  const groupId = (kind: string, name: string) => `wl:${namespace}/${kind}/${name}`;
  for (const view of buildWorkloads(bundle, namespace)) {
    const raw =
      view.kind === "Deployment" ? deployments.find((d) => d.metadata?.name === view.name)
      : view.kind === "StatefulSet" ? inNs(bundle.statefulSets).find((s) => s.metadata?.name === view.name)
      : inNs(bundle.daemonSets).find((d) => d.metadata?.name === view.name);
    const id = groupId(view.kind, view.name);
    groups.set(id, { id, kind: view.kind, name: view.name, view, pods: [], containers: raw?.spec?.template?.spec?.containers ?? [] });
  }
  const groupOfPod = new Map<string, Group>();
  for (const pod of livePods) {
    const { kind, name } = groupKeyOf(pod, deploymentRefs);
    const id = groupId(kind, name);
    let group = groups.get(id);
    if (!group) {
      group = { id, kind, name, pods: [], containers: pod.spec?.containers ?? [] };
      groups.set(id, group);
    }
    group.pods.push(pod);
    groupOfPod.set(pod.metadata?.name ?? "", group);
  }

  const toTopoPod = (pod: V1Pod): TopoPod => {
    const name = pod.metadata?.name ?? "";
    const row = rowByPod.get(key(namespace, name));
    return {
      id: podIdOf(namespace, name),
      name,
      status: row?.status ?? pod.status?.phase ?? "Unknown",
      health: row?.health ?? "unknown",
      ready: row?.ready ?? "",
      restarts: row?.restarts ?? 0,
      nodeName: pod.spec?.nodeName,
      podIp: pod.status?.podIP,
      cpu: row?.cpu.usage ?? null,
      memory: row?.memory.usage ?? null,
      commit: row?.commit,
      inService: podReady(pod),
      href: `${nsHref(namespace)}/pods/${encodeURIComponent(name)}`,
    };
  };

  for (const group of [...groups.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const pods = group.pods.map(toTopoPod).sort((a, b) => a.name.localeCompare(b.name));
    const image = group.containers[0]?.image;
    const facts: TopoFact[] = [];
    if (image) facts.push({ label: "Image", value: shortImage(image), mono: true });
    const release = group.view?.helmRelease ?? group.view?.release;
    if (release) facts.push({ label: "Release", value: release, mono: true });
    addNode({
      id: group.id,
      kind: "workload",
      title: group.name,
      subtitle: group.view ? `${group.kind} · ${group.view.ready} ready` : group.kind,
      health: group.view?.health ?? rollUp(pods.map((p) => p.health)),
      facts,
      tags: [],
      href: nsHref(namespace),
      pods,
    });
  }

  // ---- services, and the pods behind them ---------------------------------
  const clusterServices = bundle.services;
  const findService = (ns: string, name: string) => clusterServices.find((s) => s.metadata?.namespace === ns && s.metadata?.name === name);

  const serviceNode = (svc: V1Service, foreign: boolean): TopoNode => {
    const ns = svc.metadata?.namespace ?? "";
    const matched = bundle.pods.filter((p) => p.metadata?.namespace === ns && p.status?.phase !== "Succeeded" && serviceSelects(svc, p));
    const hasSelector = !!svc.spec?.selector && Object.keys(svc.spec.selector).length > 0;
    const ready = matched.filter(podReady).length;
    const ports = (svc.spec?.ports ?? []).map((p) => ({ port: p.port, protocol: p.protocol }));
    const type = svc.spec?.clusterIP === "None" ? "Headless" : (svc.spec?.type ?? "ClusterIP");
    const facts: TopoFact[] = [{ label: "Ports", value: portsText(ports) || "none", mono: true }];
    if (hasSelector) facts.push({ label: "Pods", value: `${ready}/${matched.length} ready` });
    else facts.push({ label: "Pods", value: "no selector" });
    return {
      id: svcIdOf(ns, svc.metadata?.name ?? ""),
      kind: "service",
      title: svc.metadata?.name ?? "",
      subtitle: foreign ? `${type} · namespace ${ns}` : type,
      health: hasSelector ? readiness(matched.length, ready) : "unknown",
      facts,
      tags: [],
      href: nsHref(ns),
      foreign,
    };
  };

  // Headless Services only give StatefulSet pods their DNS names, so they are left out unless something is configured to use one.
  const headless = inNs(clusterServices).filter((svc) => svc.spec?.clusterIP === "None");
  if (headless.length > 0) notes.push(`${headless.length} headless Service${headless.length === 1 ? " is" : "s are"} not drawn (they only provide pod DNS names).`);
  for (const svc of inNs(clusterServices)) {
    if (svc.spec?.clusterIP === "None") continue;
    const node = serviceNode(svc, false);
    addNode(node);
    for (const pod of livePods) {
      if (!serviceSelects(svc, pod)) continue;
      const group = groupOfPod.get(pod.metadata?.name ?? "");
      if (!group) continue;
      addEdge(node.id, group.id, "route", { toPod: podIdOf(namespace, pod.metadata?.name ?? ""), active: podReady(pod) });
    }
  }

  /** The Service node for `name`, creating a foreign or a "missing" node when it is not drawn yet. */
  const ensureService = (ns: string, name: string): string | null => {
    const id = svcIdOf(ns, name);
    if (nodes.has(id)) return id;
    const svc = findService(ns, name);
    if (!svc) return null;
    return addNode(serviceNode(svc, ns !== namespace));
  };

  // ---- ingresses, load balancers and the controller -----------------------
  const ingresses = inNs(bundle.ingresses);
  const ingressByHost = new Map<string, string>();
  const addressesOfIngress = new Map<string, string[]>();
  for (const ing of ingresses) {
    const name = ing.metadata?.name ?? "";
    const id = `ing:${namespace}/${name}`;
    const hosts = [...new Set((ing.spec?.rules ?? []).map((r) => r.host).filter((h): h is string => !!h))];
    for (const h of hosts) ingressByHost.set(h.toLowerCase(), id);
    const shown = hosts.slice(0, 3);
    const facts: TopoFact[] = shown.map((h, i) => ({ label: i === 0 ? (hosts.length > 1 ? "Hosts" : "Host") : "", value: h, mono: true }));
    if (hosts.length > shown.length) facts.push({ label: "", value: `+${hosts.length - shown.length} more` });
    if (ing.spec?.ingressClassName) facts.push({ label: "Class", value: ing.spec.ingressClassName });
    addNode({
      id,
      kind: "ingress",
      title: name,
      subtitle: "Ingress",
      health: "unknown",
      facts,
      tags: (ing.spec?.tls?.length ?? 0) > 0 ? ["TLS"] : [],
      href: `${nsHref(namespace)}?tab=network`,
    });
    addressesOfIngress.set(id, (ing.status?.loadBalancer?.ingress ?? []).map((i) => i.ip ?? i.hostname ?? "").filter(Boolean));

    for (const rule of ing.spec?.rules ?? []) {
      for (const p of rule.http?.paths ?? []) {
        const svcName = p.backend?.service?.name;
        if (!svcName) continue;
        let target = ensureService(namespace, svcName);
        if (!target) {
          target = addNode({ id: svcIdOf(namespace, svcName), kind: "service", title: svcName, subtitle: "Service not found", health: "critical", facts: [], tags: [], missing: true });
        }
        // The host is already on the Ingress card; it only goes on the line when the Ingress serves several.
        const label = hosts.length > 1 ? `${rule.host ?? "*"}${p.path ?? "/"}` : (p.path ?? "/");
        addEdge(id, target, "route", { label });
      }
    }
  }

  // Public entry: Internet -> load balancer -> controller (found through the Service that owns the address) -> Ingress.
  const lbServices = clusterServices.filter((s) => (s.status?.loadBalancer?.ingress ?? []).length > 0);
  const lbServiceByAddress = new Map<string, V1Service>();
  for (const s of lbServices) for (const i of s.status?.loadBalancer?.ingress ?? []) lbServiceByAddress.set(i.ip ?? i.hostname ?? "", s);

  const ensureInternet = () => addNode({ id: "internet", kind: "internet", title: "Internet", subtitle: "Public clients", health: "unknown", facts: [], tags: [] });

  const ensureLoadBalancer = (address: string): string => {
    const id = `lb:${address}`;
    if (nodes.has(id)) return id;
    const svc = lbServiceByAddress.get(address);
    const facts: TopoFact[] = [{ label: "Address", value: address, mono: true }];
    if (svc) {
      const ports = (svc.spec?.ports ?? []).map((p) => ({ port: p.port }));
      if (ports.length) facts.push({ label: "Ports", value: portsText(ports), mono: true });
      facts.push({ label: "Service", value: `${svc.metadata?.namespace}/${svc.metadata?.name}`, mono: true });
    }
    addNode({ id, kind: "loadbalancer", title: "Load balancer", subtitle: "Public entry point", health: "healthy", facts, tags: ["Public"] });
    addEdge(ensureInternet(), id, "route");
    return id;
  };

  const ensureController = (lbId: string, address: string): string | null => {
    const svc = lbServiceByAddress.get(address);
    if (!svc) return null;
    const ns = svc.metadata?.namespace ?? "";
    const pods = bundle.pods.filter((p) => p.metadata?.namespace === ns && p.status?.phase !== "Succeeded" && serviceSelects(svc, p));
    if (pods.length === 0) return null;
    const owners = bundle.deployments.filter((d) => d.metadata?.namespace === ns).map((d) => ({ name: d.metadata?.name ?? "", selector: d.spec?.selector }));
    const { kind, name } = groupKeyOf(pods[0], owners);
    const id = `ctl:${ns}/${kind}/${name}`;
    const ready = pods.filter(podReady).length;
    if (!nodes.has(id)) {
      const image = pods[0].spec?.containers?.[0]?.image;
      const facts: TopoFact[] = [
        { label: "Namespace", value: ns, mono: true },
        { label: "Pods", value: `${ready}/${pods.length} ready` },
      ];
      if (image) facts.push({ label: "Image", value: shortImage(image), mono: true });
      addNode({ id, kind: "controller", title: name, subtitle: "Ingress controller", health: readiness(pods.length, ready), facts, tags: [], href: nsHref(ns), foreign: ns !== namespace });
    }
    addEdge(lbId, id, "route", { label: portsText((svc.spec?.ports ?? []).map((p) => ({ port: p.port }))) });
    return id;
  };

  for (const ing of ingresses) {
    const id = `ing:${namespace}/${ing.metadata?.name ?? ""}`;
    const addresses = addressesOfIngress.get(id) ?? [];
    if (addresses.length === 0) {
      addEdge(ensureInternet(), id, "route");
      continue;
    }
    for (const address of addresses) {
      const lb = ensureLoadBalancer(address);
      const controller = ensureController(lb, address);
      addEdge(controller ?? lb, id, "route");
    }
  }

  // Services of type LoadBalancer in this namespace are reachable from the internet without an Ingress.
  for (const svc of inNs(clusterServices)) {
    for (const i of svc.status?.loadBalancer?.ingress ?? []) {
      const address = i.ip ?? i.hostname ?? "";
      if (!address) continue;
      const lb = ensureLoadBalancer(address);
      const target = svcIdOf(namespace, svc.metadata?.name ?? "");
      if (nodes.has(target)) addEdge(lb, target, "route", { label: portsText((svc.spec?.ports ?? []).map((p) => ({ port: p.port }))) });
    }
  }

  // ---- links the workloads are configured to use (literal environment values) ----
  let hiddenSettings = 0;
  const configLinks = new Map<string, { group: string; target: string; vars: Set<string> }>();
  const link = (group: Group, target: string, variable: string) => {
    const k = `${group.id}>${target}`;
    const entry = configLinks.get(k) ?? { group: group.id, target, vars: new Set<string>() };
    entry.vars.add(variable);
    configLinks.set(k, entry);
  };
  const externals = new Map<string, { host: string; schemes: Set<string>; ports: Set<number>; vars: Set<string>; groups: Set<string> }>();

  for (const group of [...groups.values()]) {
    const values: { name: string; value: string }[] = [];
    // What is actually running wins over the template it came from.
    for (const c of group.pods[0]?.spec?.containers ?? group.containers) {
      for (const e of c.env ?? []) {
        if (typeof e.value === "string") values.push({ name: e.name, value: e.value });
        else if (e.valueFrom?.secretKeyRef || e.valueFrom?.configMapKeyRef) hiddenSettings += 1;
      }
      hiddenSettings += c.envFrom?.length ?? 0;
      for (const arg of [...(c.command ?? []), ...(c.args ?? [])]) values.push({ name: "args", value: arg });
    }

    const resolveService = (host: string): string | null => {
      const ref = serviceFromHost(host, namespace);
      if (!ref || !findService(ref.namespace, ref.name)) return null;
      const id = ensureService(ref.namespace, ref.name);
      if (!id) return null;
      // A workload reaching its own Service is not a dependency.
      const svc = findService(ref.namespace, ref.name);
      if (svc && ref.namespace === namespace && group.pods.some((p) => serviceSelects(svc, p))) return null;
      return id;
    };

    for (const { name, value } of values) {
      const endpoints = extractEndpoints(value);
      if (endpoints.length === 0) {
        const bare = bareHost(value);
        const id = bare ? resolveService(bare.host) : null;
        if (id) link(group, id, name);
        continue;
      }
      for (const ep of endpoints) {
        const ingress = ingressByHost.get(ep.host);
        const service = resolveService(ep.host);
        if (ingress) link(group, ingress, name);
        else if (service) link(group, service, name);
        else if (!isLocalHost(ep.host) && !ep.host.endsWith(".svc") && !ep.host.endsWith(".cluster.local") && ep.host.includes(".")) {
          const entry = externals.get(ep.host) ?? { host: ep.host, schemes: new Set(), ports: new Set(), vars: new Set(), groups: new Set() };
          entry.schemes.add(ep.scheme);
          if (ep.port !== undefined) entry.ports.add(ep.port);
          entry.vars.add(name);
          entry.groups.add(group.id);
          externals.set(ep.host, entry);
        }
      }
    }
  }

  for (const { group, target, vars } of configLinks.values()) {
    const list = [...vars];
    addEdge(group, target, "config", { label: list.length > 1 ? `${list[0]} +${list.length - 1}` : list[0] });
  }
  for (const ext of externals.values()) {
    const id = `ext:${ext.host}`;
    const ports = [...ext.ports].sort((a, b) => a - b);
    const schemes = [...ext.schemes].sort();
    const facts: TopoFact[] = [{ label: "Protocol", value: schemes.join(", "), mono: true }];
    if (ports.length) facts.push({ label: ports.length > 1 ? "Ports" : "Port", value: ports.join(", "), mono: true });
    addNode({ id, kind: "external", title: ext.host, subtitle: describeExternal(schemes), health: "unknown", facts, tags: ["Outside the cluster"] });
    const list = [...ext.vars];
    for (const gid of ext.groups) addEdge(gid, id, "config", { label: list.length > 1 ? `${list[0]} +${list.length - 1}` : list[0] });
  }

  // ---- storage ------------------------------------------------------------
  for (const group of [...groups.values()]) {
    const claims = new Set<string>();
    for (const pod of group.pods) for (const v of pod.spec?.volumes ?? []) if (v.persistentVolumeClaim?.claimName) claims.add(v.persistentVolumeClaim.claimName);
    for (const claim of [...claims].sort()) {
      const pvc = inNs(bundle.pvcs).find((c) => c.metadata?.name === claim);
      const phase = pvc?.status?.phase ?? "Unknown";
      const size = pvc?.status?.capacity?.storage ?? pvc?.spec?.resources?.requests?.storage;
      const facts: TopoFact[] = [];
      if (size) facts.push({ label: "Size", value: size });
      if (pvc?.spec?.storageClassName) facts.push({ label: "Class", value: pvc.spec.storageClassName, mono: true });
      facts.push({ label: "Status", value: phase });
      const id = addNode({ id: `pvc:${namespace}/${claim}`, kind: "pvc", title: claim, subtitle: "Persistent volume", health: phase === "Bound" ? "healthy" : phase === "Pending" ? "warning" : phase === "Lost" ? "critical" : "unknown", facts, tags: [], href: `${nsHref(namespace)}?tab=storage` });
      addEdge(group.id, id, "mount");
    }
  }

  if (hiddenSettings > 0) {
    notes.push(`${hiddenSettings} setting${hiddenSettings === 1 ? "" : "s"} come from Secrets or ConfigMaps. The dashboard does not read those, so links defined there are not drawn.`);
  }

  return {
    namespace,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    notes,
  };
}

function describeExternal(schemes: string[]): string {
  const has = (...names: string[]) => schemes.some((s) => names.includes(s));
  if (has("mongodb", "mongodb+srv", "postgres", "postgresql", "mysql", "mariadb")) return "Database";
  if (has("redis", "rediss")) return "Cache";
  if (has("amqp", "amqps", "kafka", "nats")) return "Message broker";
  if (has("smtp", "smtps")) return "Mail server";
  return "External service";
}
