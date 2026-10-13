// The architecture diagram as plain data. Everything here is JSON-serialisable so the server can build and
// lay it out and hand it to the client component. Nothing in it can hold a credential: links to databases and
// APIs carry only a host, a port and a scheme, never the URL they were read from.

import type { Health } from "@/lib/k8s/types";

export type TopoKind = "internet" | "loadbalancer" | "controller" | "ingress" | "service" | "workload" | "pvc" | "external";

export interface TopoPod {
  /** `pod:<namespace>/<name>`, unique across the diagram. */
  id: string;
  name: string;
  status: string;
  health: Health;
  ready: string;
  restarts: number;
  nodeName?: string;
  podIp?: string;
  /** CPU cores and memory bytes, null when metrics-server is not available. */
  cpu: number | null;
  memory: number | null;
  commit?: string;
  /** False while the pod is not Ready, which means Services do not send it traffic. */
  inService: boolean;
  href: string;
}

export interface TopoFact {
  label: string;
  value: string;
  mono?: boolean;
}

export interface TopoNode {
  id: string;
  kind: TopoKind;
  title: string;
  /** One short line under the title. */
  subtitle?: string;
  health: Health;
  facts: TopoFact[];
  /** Small tags next to the title, e.g. "TLS", "Deployment". */
  tags: string[];
  /** Page to open for this object, when there is one. */
  href?: string;
  /** Only for kind "workload". */
  pods?: TopoPod[];
  /** Lives in another namespace than the one being drawn. */
  foreign?: boolean;
  /** Referenced but does not exist (an Ingress pointing at a missing Service). */
  missing?: boolean;
}

/**
 * route:  traffic the cluster sends along this path (Ingress rules, Service selectors). Taken from Kubernetes objects.
 * config: a link the workload is configured to use, read from literal environment values. Not observed traffic.
 * mount:  a volume the workload mounts.
 */
export type EdgeKind = "route" | "config" | "mount";

export interface TopoEdge {
  id: string;
  from: string;
  to: string;
  /** When the edge ends on one pod inside the workload `to`. */
  toPod?: string;
  kind: EdgeKind;
  label?: string;
  /** False when the target pod is not Ready, so no traffic is sent along it. */
  active: boolean;
}

export interface Topology {
  namespace: string;
  nodes: TopoNode[];
  edges: TopoEdge[];
  /** Plain-language caveats shown under the diagram. */
  notes: string[];
}

export interface PlacedNode extends TopoNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutTopology extends Omit<Topology, "nodes"> {
  nodes: PlacedNode[];
  width: number;
  height: number;
}
