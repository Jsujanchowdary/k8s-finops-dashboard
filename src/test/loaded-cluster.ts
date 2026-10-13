// A complete LoadedCluster built from the sample cluster, for tests of code that reads the whole loaded data
// (the AI snapshot, global search).

import type { LoadedCluster } from "@/lib/data";
import { buildAccessReport } from "@/lib/k8s/access";
import { buildCertificateViews } from "@/lib/k8s/certificates";
import { buildHelmReleases } from "@/lib/helm/releases";
import { buildNamespaceViews, buildNodeViews, buildPodRows, buildWorkloads, type RawBundle } from "@/lib/k8s/views";
import { CERT_INGRESSES, CERT_MANAGER, CERT_NOW } from "./cert-manager-sample";
import { buildSampleCluster } from "./sample-cluster";

export function sampleLoadedCluster(patch?: (b: RawBundle) => RawBundle): LoadedCluster {
  const c = buildSampleCluster(Date.UTC(2026, 9, 8), { includeDemoStates: true });
  let bundle: RawBundle = {
    nodes: c.nodes, namespaces: c.namespaces, pods: c.pods, services: c.services, ingresses: c.ingresses, pvcs: c.pvcs, pvs: c.pvs,
    deployments: c.deployments, statefulSets: c.statefulSets, daemonSets: c.daemonSets, events: c.events, nodeMetrics: c.nodeMetrics, podMetrics: c.podMetrics,
  };
  if (patch) bundle = patch(bundle);
  const rows = buildPodRows(bundle);
  return {
    ok: true,
    connection: { reachable: true, contextName: "ctx", clusterName: "wldd", server: "https://x", userName: "u", version: "v1.36.3", provider: "digitalocean", region: "blr1", metricsAvailable: true, fetchedAt: new Date(0).toISOString() },
    bundle,
    nodes: buildNodeViews(bundle),
    namespaces: buildNamespaceViews(bundle, rows),
    rows,
    nodePools: { state: "ok", pools: [{ id: "p1", name: "wldd-16gb", size: "s-8vcpu-16gb", count: 1, autoScale: true, minNodes: 1, maxNodes: 2, nodeNames: ["wldd-16gb-3oj16x"] }] },
    helm: { releases: buildHelmReleases(null, buildWorkloads(bundle), rows), revisions: "unavailable" },
    certificates: buildCertificateViews(CERT_MANAGER, CERT_INGRESSES, CERT_NOW),
    access: {
      state: "ok",
      report: buildAccessReport(
        {
          clusterRoles: [
            { metadata: { name: "cluster-admin" }, rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }] },
            { metadata: { name: "ingress-nginx" }, rules: [{ apiGroups: [""], resources: ["secrets", "pods"], verbs: ["list", "watch"] }] },
          ],
          clusterRoleBindings: [
            { metadata: { name: "k8saas:credentials:cluster-admin" }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cluster-admin" }, subjects: [{ kind: "Group", name: "do-role-name:Owner" }] },
            { metadata: { name: "ingress-nginx" }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "ingress-nginx" }, subjects: [{ kind: "ServiceAccount", namespace: "ingress-nginx", name: "ingress-nginx" }] },
          ],
          roles: [],
          roleBindings: [],
        },
        bundle.pods,
      ),
    },
    warnings: [],
  };
}
