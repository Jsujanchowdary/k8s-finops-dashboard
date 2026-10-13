import type {
  CoreV1Event,
  NodeMetric,
  PodMetric,
  V1DaemonSet,
  V1Deployment,
  V1Ingress,
  V1Namespace,
  V1Node,
  V1PersistentVolume,
  V1PersistentVolumeClaim,
  V1Pod,
  V1Service,
  V1StatefulSet,
} from "@kubernetes/client-node";
import type { RbacRaw } from "./access";
import type { CertManagerRaw } from "./certificates";

export interface RawConnection {
  contextName: string;
  clusterName: string;
  server: string;
  userName: string;
  version?: string;
  platform?: string;
  reachable: boolean;
  error?: string;
}

/**
 * Everything the dashboard knows about a cluster comes through this interface.
 * It only has read methods by design. There is no way to create, change or delete anything.
 * Secrets are intentionally not part of it. (The one exception, Helm release labels, has its own module: helm.ts.)
 */
export interface ClusterSource {
  getConnection(): Promise<RawConnection>;
  listNodes(): Promise<V1Node[]>;
  listNamespaces(): Promise<V1Namespace[]>;
  listPods(): Promise<V1Pod[]>;
  listServices(): Promise<V1Service[]>;
  listIngresses(): Promise<V1Ingress[]>;
  listPvcs(): Promise<V1PersistentVolumeClaim[]>;
  listPvs(): Promise<V1PersistentVolume[]>;
  listDeployments(): Promise<V1Deployment[]>;
  listStatefulSets(): Promise<V1StatefulSet[]>;
  listDaemonSets(): Promise<V1DaemonSet[]>;
  listEvents(): Promise<CoreV1Event[]>;
  /** null when the metrics API is not available. */
  getNodeMetrics(): Promise<NodeMetric[] | null>;
  getPodMetrics(): Promise<PodMetric[] | null>;
  /**
   * cert-manager's Certificates, Issuers, ClusterIssuers and Challenges (list calls on its custom resources).
   * null when cert-manager is not installed. The Secrets holding the certificates are not part of this.
   */
  listCertManager(): Promise<CertManagerRaw | null>;
  /** Roles, ClusterRoles and their bindings (RBAC definitions only). */
  listRbac(): Promise<RbacRaw>;
}
