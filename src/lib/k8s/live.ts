import "server-only";
import {
  type KubeConfig,
  AppsV1Api,
  CoreV1Api,
  CustomObjectsApi,
  Metrics,
  NetworkingV1Api,
  RbacAuthorizationV1Api,
  VersionApi,
} from "@kubernetes/client-node";
import { describeConnectionError } from "@/lib/clusters/errors";
import type { RbacRaw } from "./access";
import type { CertManagerRaw, RawObject } from "./certificates";
import type { ClusterSource, RawConnection } from "./source";
import { readOnlyClient, withTimeout } from "./readonly";

const TIMEOUT_MS = 15_000;

/**
 * Live source: reads the cluster `kc` points at (a local kubeconfig context or a cluster saved in Settings).
 * Only list/read/get calls are made, and no Secret is ever requested.
 */
export function createLiveSource(kc: KubeConfig): ClusterSource {

  const core = readOnlyClient(kc.makeApiClient(CoreV1Api));
  const apps = readOnlyClient(kc.makeApiClient(AppsV1Api));
  const networking = readOnlyClient(kc.makeApiClient(NetworkingV1Api));
  const version = readOnlyClient(kc.makeApiClient(VersionApi));
  const custom = readOnlyClient(kc.makeApiClient(CustomObjectsApi));
  const rbac = readOnlyClient(kc.makeApiClient(RbacAuthorizationV1Api));
  const metrics = new Metrics(kc);

  const call = <T>(label: string, fn: () => Promise<T>) => withTimeout(fn(), TIMEOUT_MS, label);

  return {
    async getConnection(): Promise<RawConnection> {
      const cluster = kc.getCurrentCluster();
      const user = kc.getCurrentUser();
      const base = {
        contextName: kc.getCurrentContext(),
        clusterName: cluster?.name ?? "unknown",
        server: cluster?.server ?? "unknown",
        userName: user?.name ?? "unknown",
      };
      try {
        const info = await call("version", () => version.getCode());
        return { ...base, reachable: true, version: info.gitVersion, platform: info.platform };
      } catch (error) {
        return {
          ...base,
          reachable: false,
          error: describeConnectionError(error),
        };
      }
    },

    async listNodes() {
      return (await call("nodes", () => core.listNode())).items;
    },
    async listNamespaces() {
      return (await call("namespaces", () => core.listNamespace())).items;
    },
    async listPods() {
      return (await call("pods", () => core.listPodForAllNamespaces())).items;
    },
    async listServices() {
      return (await call("services", () => core.listServiceForAllNamespaces())).items;
    },
    async listIngresses() {
      return (await call("ingresses", () => networking.listIngressForAllNamespaces())).items;
    },
    async listPvcs() {
      return (await call("pvcs", () => core.listPersistentVolumeClaimForAllNamespaces())).items;
    },
    async listPvs() {
      return (await call("pvs", () => core.listPersistentVolume())).items;
    },
    async listDeployments() {
      return (await call("deployments", () => apps.listDeploymentForAllNamespaces())).items;
    },
    async listStatefulSets() {
      return (await call("statefulsets", () => apps.listStatefulSetForAllNamespaces())).items;
    },
    async listDaemonSets() {
      return (await call("daemonsets", () => apps.listDaemonSetForAllNamespaces())).items;
    },
    async listEvents() {
      return (await call("events", () => core.listEventForAllNamespaces())).items;
    },

    async getNodeMetrics() {
      try {
        return (await call("node metrics", () => metrics.getNodeMetrics())).items;
      } catch {
        return null;
      }
    },
    async getPodMetrics() {
      try {
        return (await call("pod metrics", () => metrics.getPodMetrics())).items;
      } catch {
        return null;
      }
    },

    async listRbac(): Promise<RbacRaw> {
      const [clusterRoles, clusterRoleBindings, roles, roleBindings] = await Promise.all([
        call("clusterroles", () => rbac.listClusterRole()),
        call("clusterrolebindings", () => rbac.listClusterRoleBinding()),
        call("roles", () => rbac.listRoleForAllNamespaces()),
        call("rolebindings", () => rbac.listRoleBindingForAllNamespaces()),
      ]);
      return { clusterRoles: clusterRoles.items, clusterRoleBindings: clusterRoleBindings.items, roles: roles.items, roleBindings: roleBindings.items };
    },

    async listCertManager(): Promise<CertManagerRaw | null> {
      const group = "cert-manager.io";
      const items = (body: unknown) => ((body as { items?: RawObject[] })?.items ?? []);
      const namespaced = (plural: string, g = group) => call(plural, () => custom.listCustomObjectForAllNamespaces({ group: g, version: "v1", resourcePlural: plural })).then(items);
      try {
        const [certificates, issuers, clusterIssuers, challenges] = await Promise.all([
          namespaced("certificates"),
          namespaced("issuers"),
          call("clusterissuers", () => custom.listClusterCustomObject({ group, version: "v1", plural: "clusterissuers" })).then(items),
          // Challenges only exist while an ACME certificate is being issued. Missing ACME support is not an error.
          namespaced("challenges", "acme.cert-manager.io").catch(() => [] as RawObject[]),
        ]);
        return { certificates, issuers, clusterIssuers, challenges };
      } catch (error) {
        // 404: the cert-manager resource types do not exist, so cert-manager is not installed.
        if ((error as { code?: number })?.code === 404) return null;
        throw error;
      }
    },
  };
}
