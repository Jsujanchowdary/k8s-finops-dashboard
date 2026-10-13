import "server-only";
import type { KubeConfig } from "@kubernetes/client-node";
import { cookies } from "next/headers";
import { cache } from "react";
import { IN_CLUSTER_CONTEXT, kubeConfigForContext, kubeConfigFromInput, localKubeConfig } from "@/lib/k8s/kubeconfig";
import { detectProvider } from "@/lib/providers/detect";
import { storedClusters, summarize } from "./store";
import { CLUSTER_COOKIE, type ClusterSummary } from "./types";

/**
 * Every cluster the dashboard can show, and which one this browser is looking at.
 * Local clusters are the contexts of this machine's kubeconfig (or the pod's own ServiceAccount when deployed inside
 * a cluster); saved clusters were added in Settings. The browser only ever holds a cluster's id, in a cookie.
 */

const LOCAL_PREFIX = "local:";

function localClusters(): ClusterSummary[] {
  const kc = localKubeConfig();
  if (!kc) return [];
  return kc.getContexts().map((ctx) => {
    const server = kc.getCluster(ctx.cluster)?.server ?? "";
    return {
      id: `${LOCAL_PREFIX}${ctx.name}`,
      name: ctx.name === IN_CLUSTER_CONTEXT ? "in-cluster" : ctx.name,
      server,
      kind: "local" as const,
      provider: detectProvider({ server, providerIds: [] }),
    };
  });
}

export async function listClusters(): Promise<ClusterSummary[]> {
  return [...localClusters(), ...(await storedClusters()).map(summarize)];
}

/** Without a choice in the browser: KUBE_CONTEXT, else the kubeconfig's current context, else the first cluster. */
export function defaultClusterId(list: ClusterSummary[]): string | undefined {
  const pinned = process.env.KUBE_CONTEXT;
  const current = localKubeConfig()?.getCurrentContext();
  for (const wanted of [pinned, current]) {
    if (wanted && list.some((c) => c.id === `${LOCAL_PREFIX}${wanted}`)) return `${LOCAL_PREFIX}${wanted}`;
  }
  return list[0]?.id;
}

// One KubeConfig per cluster for the life of the process, so its clients (and their connections) are reused.
const configs = new Map<string, KubeConfig>();

export async function kubeConfigFor(id: string): Promise<KubeConfig | undefined> {
  const hit = configs.get(id);
  if (hit) return hit;
  let kc: KubeConfig | undefined;
  if (id.startsWith(LOCAL_PREFIX)) {
    kc = kubeConfigForContext(id.slice(LOCAL_PREFIX.length));
  } else {
    const stored = (await storedClusters()).find((c) => c.id === id);
    kc = stored ? kubeConfigFromInput(stored) : undefined;
  }
  if (kc) configs.set(id, kc);
  return kc;
}

/** Drops what was kept for a cluster that was removed. */
export function forgetClusterConfig(id: string): void {
  configs.delete(id);
}

export interface SelectedCluster {
  summary: ClusterSummary;
  kc: KubeConfig;
  all: ClusterSummary[];
}

/** The cluster this browser chose (its cookie), or the default. null when there is no cluster at all. Once per request. */
export const selectedCluster = cache(async (): Promise<SelectedCluster | null> => {
  const all = await listClusters();
  const chosen = (await cookies()).get(CLUSTER_COOKIE)?.value;
  const ids = [chosen && all.some((c) => c.id === chosen) ? chosen : undefined, defaultClusterId(all)];
  for (const id of ids) {
    if (!id) continue;
    const kc = await kubeConfigFor(id);
    const summary = all.find((c) => c.id === id);
    if (kc && summary) return { summary, kc, all };
  }
  return null;
});
