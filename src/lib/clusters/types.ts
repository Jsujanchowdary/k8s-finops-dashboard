// What the browser may know about a cluster: names and addresses, never credentials. Shared by server and client.

import type { ProviderId } from "@/lib/providers/detect";

/** The browser cookie that remembers which cluster this browser is looking at. Holds only a cluster id. */
export const CLUSTER_COOKIE = "do-dashboard-cluster";

export interface ClusterSummary {
  /** "local:<context>" for the machine's kubeconfig, "saved:<random>" for clusters added in Settings. */
  id: string;
  name: string;
  server: string;
  /** local: from the kubeconfig kubectl uses on this machine (or in-cluster). saved: added in Settings. */
  kind: "local" | "saved";
  /** Detected when the cluster was added; local clusters are detected when they are loaded. */
  provider?: ProviderId;
  /** How a saved cluster logs in. */
  auth?: "token" | "client certificate";
  addedAt?: string;
}

/** The result of trying a connection before it is saved. */
export interface ConnectionCheck {
  ok: boolean;
  /** What went wrong, in words someone can act on. */
  message?: string;
  version?: string;
  provider?: ProviderId;
  /** Each read the dashboard needs, tried with a limit of one item. */
  reads: { namespaces: CheckState; nodes: CheckState; pods: CheckState };
}

export type CheckState = "ok" | "forbidden" | "error" | "skipped";
