import "server-only";
import { cache } from "react";
import { selectedCluster } from "@/lib/clusters/registry";
import { loadNodePools } from "@/lib/do/node-pools";
import type { NodePoolsResult } from "@/lib/do/node-pools-core";
import { buildHelmReleases } from "@/lib/helm/releases";
import { getSource } from "@/lib/k8s";
import { buildAccessReport, type AccessData } from "@/lib/k8s/access";
import { buildCertificateViews, type CertificatesData } from "@/lib/k8s/certificates";
import { loadHelmRevisions } from "@/lib/k8s/helm";
import { detectProvider } from "@/lib/providers/detect";
import {
  buildNamespaceViews,
  buildNodeViews,
  buildPodDetail,
  buildPodRows,
  buildWorkloads,
  type RawBundle,
} from "@/lib/k8s/views";
import type { ConnectionInfo, HelmReleaseView, NamespaceView, NodeView, PodDetail, PodRow } from "@/lib/k8s/types";

export type ClusterData =
  | {
      ok: true;
      connection: ConnectionInfo;
      bundle: RawBundle;
      nodes: NodeView[];
      namespaces: NamespaceView[];
      rows: PodRow[];
      nodePools: NodePoolsResult;
      helm: { releases: HelmReleaseView[]; revisions: "ok" | "unavailable"; message?: string };
      /** TLS certificates from cert-manager. */
      certificates: CertificatesData;
      /** Who and what can act on the cluster (RBAC). */
      access: AccessData;
      warnings: string[];
    }
  | { ok: false; connection: ConnectionInfo; error: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "body" in error) return String((error as { body: unknown }).body);
  return String(error);
}

/**
 * Loads everything once per request (React cache) and turns it into view models.
 * Nodes, namespaces and pods are required. Everything else degrades to empty with a warning,
 * so a missing permission never takes the whole page down.
 */
/** A cluster that was reached. */
export type LoadedCluster = Extract<ClusterData, { ok: true }>;

export const loadCluster = cache(async (): Promise<ClusterData> => {
  const selected = await selectedCluster();
  if (!selected) {
    const none: ConnectionInfo = { reachable: false, contextName: "", clusterName: "No cluster", server: "", userName: "", metricsAvailable: false, fetchedAt: new Date().toISOString() };
    return { ok: false, connection: none, error: "No cluster is connected yet. Add one in Settings → Clusters." };
  }
  const { summary, kc } = selected;
  const source = await getSource(summary.id, kc);
  const raw = await source.getConnection();
  const base: ConnectionInfo = { ...raw, clusterId: summary.id, clusterName: summary.kind === "saved" ? summary.name : raw.clusterName, provider: summary.provider, metricsAvailable: false, fetchedAt: new Date().toISOString() };
  if (!raw.reachable) return { ok: false, connection: base, error: raw.error ?? "The cluster is not reachable." };

  // Autoscaling settings live in DigitalOcean, not Kubernetes. This never throws and runs alongside the cluster calls.
  // Only DigitalOcean's are read so far; other clouds show nothing (lib/providers).
  const nodePoolsPromise: Promise<NodePoolsResult> = summary.provider === "digitalocean" || !summary.provider ? loadNodePools(raw.server) : Promise.resolve({ state: "not-doks" });
  // Helm revision labels (metadata only). Never throws; without them releases are still listed from the workloads.
  const helmPromise = loadHelmRevisions(kc);
  // cert-manager's custom resources. Never throws: not installed or not allowed is reported, not fatal.
  const rbacPromise = source.listRbac().then(
    (raw) => ({ ok: true as const, raw }),
    (error: unknown) => ({ ok: false as const, message: errorMessage(error) }),
  );
  const certManagerPromise = source.listCertManager().then(
    (raw) => ({ ok: true as const, raw }),
    (error: unknown) => ({ ok: false as const, message: errorMessage(error) }),
  );

  const warnings: string[] = [];
  const optional = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await fn();
    } catch (error) {
      warnings.push(`${label}: ${errorMessage(error)}`);
      return [];
    }
  };

  try {
    const [nodes, namespaces, pods] = await Promise.all([source.listNodes(), source.listNamespaces(), source.listPods()]);
    const [services, ingresses, pvcs, pvs, deployments, statefulSets, daemonSets, events, nodeMetrics, podMetrics] = await Promise.all([
      optional("services", () => source.listServices()),
      optional("ingresses", () => source.listIngresses()),
      optional("persistent volume claims", () => source.listPvcs()),
      optional("persistent volumes", () => source.listPvs()),
      optional("deployments", () => source.listDeployments()),
      optional("statefulsets", () => source.listStatefulSets()),
      optional("daemonsets", () => source.listDaemonSets()),
      optional("events", () => source.listEvents()),
      source.getNodeMetrics(),
      source.getPodMetrics(),
    ]);

    const bundle: RawBundle = { nodes, namespaces, pods, services, ingresses, pvcs, pvs, deployments, statefulSets, daemonSets, events, nodeMetrics, podMetrics };
    const nodePools = await nodePoolsPromise;
    const helmRevisions = await helmPromise;
    const certManager = await certManagerPromise;
    const rbacRaw = await rbacPromise;
    const nodeViews = buildNodeViews(bundle);
    const rows = buildPodRows(bundle);
    const first = nodeViews[0];
    const provider = detectProvider({ server: raw.server, providerIds: nodeViews.map((n) => n.providerId) });
    const metricsAvailable = nodeMetrics !== null && podMetrics !== null;
    if (!metricsAvailable) warnings.push("metrics-server is not available, so live CPU and memory usage is hidden.");

    return {
      ok: true,
      connection: { ...base, provider, region: first?.region, metricsAvailable },
      bundle,
      nodes: nodeViews,
      namespaces: buildNamespaceViews(bundle, rows),
      rows,
      nodePools,
      helm: {
        releases: buildHelmReleases(helmRevisions.state === "ok" ? helmRevisions.revisions : null, buildWorkloads(bundle), rows),
        revisions: helmRevisions.state === "ok" ? "ok" : "unavailable",
        message: helmRevisions.state === "error" ? helmRevisions.message : undefined,
      },
      certificates: !certManager.ok
        ? { state: "error", message: certManager.message }
        : certManager.raw === null
          ? { state: "not-installed" }
          : buildCertificateViews(certManager.raw, ingresses),
      access: rbacRaw.ok ? { state: "ok", report: buildAccessReport(rbacRaw.raw, pods) } : { state: "error", message: rbacRaw.message },
      warnings,
    };
  } catch (error) {
    return { ok: false, connection: base, error: errorMessage(error) };
  }
});

export async function getPodDetail(namespace: string, name: string): Promise<PodDetail | null> {
  const data = await loadCluster();
  if (!data.ok) return null;
  return buildPodDetail(data.bundle, namespace, name);
}
