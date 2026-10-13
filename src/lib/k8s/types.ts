// View models. These are plain JSON-serialisable objects (no Date, no class instances)
// so they can cross the server -> client component boundary.

import type { ProviderId } from "@/lib/providers/detect";

export type Health = "healthy" | "warning" | "critical" | "unknown";

export interface ConnectionInfo {
  /** The dashboard's id for this cluster (see lib/clusters). */
  clusterId?: string;
  reachable: boolean;
  error?: string;
  contextName: string;
  clusterName: string;
  server: string;
  userName: string;
  version?: string;
  platform?: string;
  /** Which cloud runs it (lib/providers/detect). */
  provider?: ProviderId;
  region?: string;
  metricsAvailable: boolean;
  fetchedAt: string;
}

/** CPU values are cores, memory values are bytes. `usage` is null when metrics are unavailable. */
export interface ResourceTriple {
  request: number;
  limit: number;
  usage: number | null;
}

export interface NodeCondition {
  type: string;
  status: string;
  /** Whether this status is good or bad for this kind of condition (True is healthy for Ready, a problem for MemoryPressure). */
  health: Health;
  reason?: string;
  message?: string;
}

export interface NodeView {
  name: string;
  ready: boolean;
  status: string;
  roles: string[];
  instanceType?: string;
  region?: string;
  zone?: string;
  nodePool?: string;
  providerId?: string;
  kubeletVersion: string;
  osImage: string;
  kernelVersion: string;
  containerRuntime: string;
  architecture: string;
  internalIp?: string;
  externalIp?: string;
  createdAt: string;
  unschedulable: boolean;
  cpu: { capacity: number; allocatable: number; requests: number; limits: number; usage: number | null };
  memory: { capacity: number; allocatable: number; requests: number; limits: number; usage: number | null };
  pods: { count: number; capacity: number };
  conditions: NodeCondition[];
  taints: string[];
  labels: Record<string, string>;
}

export interface PodCounts {
  total: number;
  running: number;
  pending: number;
  failed: number;
  succeeded: number;
  unhealthy: number;
}

export interface NamespaceView {
  name: string;
  phase: string;
  createdAt: string;
  health: Health;
  pods: PodCounts;
  restarts: number;
  cpu: ResourceTriple;
  memory: ResourceTriple;
  counts: {
    deployments: number;
    statefulsets: number;
    daemonsets: number;
    services: number;
    ingresses: number;
    pvcs: number;
  };
  storageBytes: number;
  warningEvents: number;
  hosts: string[];
}

export interface OwnerView {
  kind: string;
  name: string;
  controller: boolean;
}

export interface PodRow {
  name: string;
  namespace: string;
  /** Display status, kubectl style: Running, Pending, CrashLoopBackOff, Completed, Terminating... */
  status: string;
  phase: string;
  health: Health;
  ready: string;
  restarts: number;
  nodeName?: string;
  podIp?: string;
  createdAt: string;
  owner?: OwnerView;
  release?: string;
  /** Git commit the running image was built from (pod label `commit`, else the image tag). */
  commit?: string;
  qos?: string;
  images: string[];
  cpu: ResourceTriple;
  memory: ResourceTriple;
}

export type StateKind = "running" | "waiting" | "terminated" | "unknown";

export interface ContainerStateView {
  kind: StateKind;
  reason?: string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  signal?: number;
}

export interface EnvVarView {
  name: string;
  source: "literal" | "secret" | "configmap" | "field" | "resource";
  /** Reference such as "dms-secret/DB_URL" for values that come from a Secret, ConfigMap or field. */
  ref?: string;
  /** The value itself, for variables set directly on the container. */
  value?: string;
}

export interface EnvFromView {
  kind: "secret" | "configmap";
  name: string;
  prefix?: string;
  optional?: boolean;
}

export interface ProbeView {
  kind: "liveness" | "readiness" | "startup";
  type: "http" | "tcp" | "exec" | "grpc" | "unknown";
  target: string;
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

export interface ContainerView {
  name: string;
  isInit: boolean;
  image: string;
  imagePullPolicy?: string;
  imageId?: string;
  containerId?: string;
  command?: string[];
  args?: string[];
  state: ContainerStateView;
  lastState?: ContainerStateView;
  ready: boolean;
  started?: boolean;
  restartCount: number;
  ports: { name?: string; containerPort: number; protocol: string; hostPort?: number }[];
  resources: {
    cpu: ResourceTriple;
    memory: ResourceTriple;
    requestsRaw: Record<string, string>;
    limitsRaw: Record<string, string>;
  };
  env: EnvVarView[];
  envFrom: EnvFromView[];
  mounts: { name: string; mountPath: string; readOnly: boolean; subPath?: string }[];
  probes: ProbeView[];
  securityContext?: Record<string, unknown>;
}

export interface PvcView {
  name: string;
  namespace: string;
  status: string;
  storageClass?: string;
  requestedBytes: number;
  capacityBytes: number;
  accessModes: string[];
  volumeName?: string;
  volumeMode?: string;
  createdAt: string;
  usedBy: string[];
}

export interface VolumeView {
  name: string;
  type: "pvc" | "secret" | "configmap" | "emptyDir" | "projected" | "hostPath" | "downwardAPI" | "other";
  /** Name of the secret/configmap/claim/path. Only names, never contents. */
  source: string;
  detail?: string;
  pvc?: PvcView;
}

export interface IngressRuleView {
  host?: string;
  path: string;
  pathType?: string;
  serviceName: string;
  servicePort: string;
}

export interface IngressView {
  name: string;
  namespace: string;
  className?: string;
  hosts: string[];
  rules: IngressRuleView[];
  tls: { hosts: string[]; secretName?: string }[];
  address: string[];
  createdAt: string;
}

export interface ServicePortView {
  name?: string;
  port: number;
  targetPort: string;
  protocol: string;
  nodePort?: number;
}

export interface ServiceView {
  name: string;
  namespace: string;
  type: string;
  clusterIp?: string;
  externalIps: string[];
  loadBalancer: string[];
  ports: ServicePortView[];
  selector: Record<string, string>;
  createdAt: string;
  ingresses: IngressView[];
}

export interface EventView {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen?: string;
  lastSeen: string;
  source?: string;
  object?: string;
}

export interface ConditionView {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransition?: string;
}

export interface WorkloadView {
  kind: "Deployment" | "StatefulSet" | "DaemonSet";
  name: string;
  namespace: string;
  ready: string;
  health: Health;
  images: string[];
  createdAt: string;
  strategy?: string;
  release?: string;
  /** Release name from the `meta.helm.sh/release-name` annotation Helm puts on what it creates. */
  helmRelease?: string;
}

export interface PodDetail {
  row: PodRow;
  uid?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  owners: OwnerView[];
  conditions: ConditionView[];
  containers: ContainerView[];
  volumes: VolumeView[];
  network: {
    podIp?: string;
    podIps: string[];
    hostIp?: string;
    hostNetwork: boolean;
    dnsPolicy?: string;
    hostname?: string;
    subdomain?: string;
    ports: { container: string; name?: string; port: number; protocol: string }[];
    services: ServiceView[];
  };
  scheduling: {
    nodeName?: string;
    nodeSelector: Record<string, string>;
    tolerations: { key?: string; operator?: string; value?: string; effect?: string; tolerationSeconds?: number }[];
    affinity?: unknown;
    priorityClass?: string;
    priority?: number;
    schedulerName?: string;
    restartPolicy?: string;
    terminationGracePeriodSeconds?: number;
  };
  security: {
    serviceAccount?: string;
    imagePullSecrets: string[];
    podSecurityContext?: unknown;
  };
  events: EventView[];
  /** The pod object as Kubernetes returns it, without managed fields and the last-applied annotation. */
  raw: unknown;
}

export interface HelmRevisionView {
  revision: number;
  status: string;
  updatedAt?: string;
}

export interface HelmReleaseView {
  name: string;
  namespace: string;
  /** From the Helm release Secrets' labels. Undefined when those could not be read. */
  revision?: number;
  status?: string;
  updatedAt?: string;
  /** Newest first. Helm keeps 10 by default. */
  revisions: HelmRevisionView[];
  workloads: WorkloadView[];
  pods: { total: number; ready: number; unhealthy: number };
  images: string[];
  commits: string[];
  health: Health;
}
