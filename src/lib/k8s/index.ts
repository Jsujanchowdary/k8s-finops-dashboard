import type { KubeConfig } from "@kubernetes/client-node";
import type { ClusterSource } from "./source";

// One live source per cluster for the life of the process (rebuilt after a dev hot reload, so code changes apply).
const sources = new Map<string, Promise<ClusterSource>>();

/** The live source for one cluster. The Kubernetes client is loaded lazily. */
export function getSource(id: string, kc: KubeConfig): Promise<ClusterSource> {
  let source = sources.get(id);
  if (!source) {
    source = import("./live").then(({ createLiveSource }) => createLiveSource(kc));
    sources.set(id, source);
  }
  return source;
}

/** Drops the source of a cluster that was removed. */
export function forgetSource(id: string): void {
  sources.delete(id);
}
