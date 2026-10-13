// Test-only sample cluster. It is not part of the app and nothing in src/app or src/components imports it.
// The shape follows the real Kubernetes API objects. Names, requests, limits and usage mirror the
// shared DOKS cluster; IPs are documentation addresses. The `demo-states` namespace contains
// deliberately broken pods so the UI's warning and error states can be tested.
import type {
  CoreV1Event,
  NodeMetric,
  PodMetric,
  V1Container,
  V1DaemonSet,
  V1Deployment,
  V1EnvVar,
  V1Ingress,
  V1Namespace,
  V1Node,
  V1NodeSystemInfo,
  V1PersistentVolume,
  V1PersistentVolumeClaim,
  V1Pod,
  V1Service,
  V1StatefulSet,
} from "@kubernetes/client-node";
import type { RawConnection } from "@/lib/k8s/source";

const HOUR = 3_600_000;
const NODE = "wldd-16gb-3oj16x";
const NODE_IP = "10.122.0.5";
const NODE_EXTERNAL_IP = "203.0.113.10";
const LB_IP = "203.0.113.50";

function hashStr(seed: string, len: number, alphabet = "bcdfghjklmnpqrstvwxz2456789"): string {
  let h = 2166136261;
  let out = "";
  for (let i = 0; i < len; i += 1) {
    for (const ch of `${seed}:${i}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    out += alphabet[h % alphabet.length];
  }
  return out;
}

function uid(seed: string): string {
  const a = hashStr(seed, 32, "0123456789abcdef");
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-${a.slice(12, 16)}-${a.slice(16, 20)}-${a.slice(20, 32)}`;
}

type Quantities = { cpu?: string; memory?: string };
type Labels = Record<string, string>;
type State = "crashloop" | "pending" | "completed";

interface AppDef {
  ns: string;
  workload: string;
  kind: "Deployment" | "StatefulSet" | "DaemonSet";
  replicas?: number;
  container: string;
  image: string;
  sidecars?: string[];
  ports?: { name?: string; port: number; protocol?: string }[];
  req?: Quantities;
  lim?: Quantities;
  /** millicores / MiB, taken from `kubectl top pods`. */
  usage: { cpu: number; mem: number };
  labels: Labels;
  env?: V1EnvVar[];
  secretEnvFrom?: string[];
  pvcs?: string[];
  secretVolumes?: string[];
  configMapVolumes?: string[];
  pullSecret?: boolean;
  serviceAccount?: string;
  ageHours: number;
  restarts?: number;
  probes?: { port: number; path?: string };
  state?: State;
  hostNetwork?: boolean;
  release?: string;
  strategy?: string;
}

const dms = (component: string, release: string): Labels => ({ app: "dms", component, release });
const instance = (name: string, inst = name): Labels => ({
  "app.kubernetes.io/name": name,
  "app.kubernetes.io/instance": inst,
});
const k8sApp = (name: string): Labels => ({ "k8s-app": name });

const secretRef = (name: string, key: string): V1EnvVar["valueFrom"] => ({ secretKeyRef: { name, key } });

const APPS: AppDef[] = [
  // --- cert-manager ---
  { ns: "cert-manager", workload: "cert-manager", kind: "Deployment", container: "cert-manager-controller", image: "quay.io/jetstack/cert-manager-controller:v1.21.1", ports: [{ name: "http-metrics", port: 9402 }], usage: { cpu: 2, mem: 36 }, labels: instance("cert-manager", "cert-manager"), serviceAccount: "cert-manager", ageHours: 1160, release: "cert-manager" },
  { ns: "cert-manager", workload: "cert-manager-cainjector", kind: "Deployment", container: "cert-manager-cainjector", image: "quay.io/jetstack/cert-manager-cainjector:v1.21.1", usage: { cpu: 1, mem: 29 }, labels: instance("cainjector", "cert-manager"), serviceAccount: "cert-manager-cainjector", ageHours: 1160, release: "cert-manager" },
  { ns: "cert-manager", workload: "cert-manager-webhook", kind: "Deployment", container: "cert-manager-webhook", image: "quay.io/jetstack/cert-manager-webhook:v1.21.1", ports: [{ name: "https", port: 10250 }], usage: { cpu: 1, mem: 18 }, labels: instance("webhook", "cert-manager"), serviceAccount: "cert-manager-webhook", ageHours: 1160, release: "cert-manager" },

  // --- DMS (staging) ---
  { ns: "do-dms-staging", workload: "do-dms-staging-dms-api", kind: "Deployment", container: "dms-api", image: "ghcr.io/wlddhq/dms-api:do-dms-staging-438a32b", ports: [{ port: 3001 }], req: { cpu: "50m", memory: "128Mi" }, lim: { cpu: "500m", memory: "512Mi" }, usage: { cpu: 1, mem: 203 }, labels: dms("api", "do-dms-staging-dms-api"), secretEnvFrom: ["dms-secret"], pullSecret: true, ageHours: 48, probes: { port: 3001 }, release: "do-dms-staging-dms-api", strategy: "RollingUpdate" },
  {
    ns: "do-dms-staging", workload: "do-dms-staging-dms-tally", kind: "Deployment", container: "dms-tally", image: "ghcr.io/wlddhq/dms-tally:do-dms-staging-438a32b",
    req: { cpu: "50m", memory: "128Mi" }, lim: { cpu: "500m", memory: "512Mi" }, usage: { cpu: 2, mem: 36 }, labels: dms("tally", "do-dms-staging-dms-tally"),
    secretEnvFrom: ["dms-secret"], env: [{ name: "MQ_URL", valueFrom: secretRef("dms-secret", "RABBITMQ_URL") }, { name: "MQ_QUEUE", valueFrom: secretRef("dms-secret", "QUEUE_NAME") }],
    pullSecret: true, ageHours: 48, restarts: 5, release: "do-dms-staging-dms-tally", strategy: "RollingUpdate",
  },
  {
    ns: "do-dms-staging", workload: "do-dms-staging-dms-ui", kind: "Deployment", container: "dms-ui", image: "ghcr.io/wlddhq/dms-ui:do-dms-staging-438a32b", ports: [{ port: 3000 }],
    req: { cpu: "50m", memory: "128Mi" }, lim: { cpu: "500m", memory: "512Mi" }, usage: { cpu: 1, mem: 169 }, labels: dms("ui", "do-dms-staging-dms-ui"),
    secretEnvFrom: ["dms-secret"], env: [{ name: "API_ENDPOINT_INTERNAL", value: "http://do-dms-staging-dms-api.do-dms-staging.svc.cluster.local:3001/api/v1/" }, { name: "UNAUTH_API_ENDPOINT_INTERNAL", value: "http://do-dms-staging-dms-api.do-dms-staging.svc.cluster.local:3001/v1/" }],
    pullSecret: true, ageHours: 48, probes: { port: 3000 }, release: "do-dms-staging-dms-ui", strategy: "RollingUpdate",
  },

  // --- infisical ---
  { ns: "infisical", workload: "infisical-infisical-standalone-infisical", kind: "Deployment", container: "infisical", image: "infisical/infisical:v0.150.0", ports: [{ port: 8080 }], req: { cpu: "350m", memory: "1000Mi" }, lim: { memory: "1000Mi" }, usage: { cpu: 11, mem: 762 }, labels: instance("infisical-standalone", "infisical"), secretEnvFrom: ["infisical-secrets"], ageHours: 1150, release: "infisical", strategy: "RollingUpdate" },
  { ns: "infisical", workload: "postgresql", kind: "StatefulSet", container: "postgresql", image: "docker.io/bitnami/postgresql:16", ports: [{ name: "tcp-postgresql", port: 5432 }], usage: { cpu: 13, mem: 62 }, labels: instance("postgresql", "infisical"), pvcs: ["data-postgresql-0"], ageHours: 1150, release: "infisical" },
  { ns: "infisical", workload: "redis-master", kind: "StatefulSet", container: "redis", image: "docker.io/bitnami/redis:7.4", ports: [{ name: "redis", port: 6379 }], usage: { cpu: 25, mem: 11 }, labels: instance("redis", "infisical"), pvcs: ["redis-data-redis-master-0"], ageHours: 1150, release: "infisical" },
  { ns: "infisical-operator", workload: "infisical-opera-controller-manager", kind: "Deployment", container: "manager", image: "infisical/kubernetes-operator:v0.11.8", req: { cpu: "10m", memory: "64Mi" }, lim: { cpu: "500m", memory: "128Mi" }, usage: { cpu: 3, mem: 20 }, labels: instance("secrets-operator", "infisical-operator"), serviceAccount: "infisical-operator", ageHours: 1130, restarts: 181, release: "infisical-operator" },

  // --- ingress ---
  { ns: "ingress-nginx", workload: "ingress-nginx-controller", kind: "Deployment", container: "controller", image: "registry.k8s.io/ingress-nginx/controller:v1.15.1", ports: [{ name: "http", port: 80 }, { name: "https", port: 443 }, { name: "webhook", port: 8443 }], req: { cpu: "100m", memory: "90Mi" }, usage: { cpu: 2, mem: 126 }, labels: instance("ingress-nginx", "ingress-nginx"), probes: { port: 10254, path: "/healthz" }, ageHours: 1180, release: "ingress-nginx", strategy: "RollingUpdate" },

  // --- kube-system ---
  { ns: "kube-system", workload: "cilium", kind: "DaemonSet", container: "cilium-agent", sidecars: ["config"], image: "quay.io/cilium/cilium:v1.18.3", req: { cpu: "310m", memory: "332Mi" }, lim: { cpu: "1", memory: "1Gi" }, usage: { cpu: 80, mem: 391 }, labels: k8sApp("cilium"), hostNetwork: true, serviceAccount: "cilium", ageHours: 1180 },
  { ns: "kube-system", workload: "coredns", kind: "Deployment", replicas: 2, container: "coredns", image: "registry.k8s.io/coredns/coredns:v1.12.1", ports: [{ name: "dns", port: 53, protocol: "UDP" }, { name: "dns-tcp", port: 53 }, { name: "metrics", port: 9153 }], req: { cpu: "100m", memory: "170Mi" }, lim: { memory: "170Mi" }, usage: { cpu: 3, mem: 26 }, labels: k8sApp("kube-dns"), serviceAccount: "coredns", ageHours: 1180, strategy: "RollingUpdate" },
  { ns: "kube-system", workload: "csi-do-node", kind: "DaemonSet", container: "csi-do-plugin", sidecars: ["csi-node-driver-registrar"], image: "digitalocean/do-csi-plugin:v4.14.0", usage: { cpu: 1, mem: 21 }, labels: { app: "csi-do-node" }, hostNetwork: false, ageHours: 740 },
  { ns: "kube-system", workload: "do-node-agent", kind: "DaemonSet", container: "do-node-agent", image: "docker.io/digitalocean/do-agent:3.18.0", req: { cpu: "102m", memory: "80Mi" }, lim: { memory: "300Mi" }, usage: { cpu: 0, mem: 14 }, labels: { app: "do-node-agent" }, ageHours: 1180 },
  { ns: "kube-system", workload: "doks-telemetry-config-reloader", kind: "DaemonSet", container: "reloader", image: "docker.io/digitalocean/config-reloader:1.0", usage: { cpu: 0, mem: 5 }, labels: { app: "doks-telemetry-config-reloader" }, ageHours: 1180 },
  { ns: "kube-system", workload: "hubble-relay", kind: "Deployment", container: "hubble-relay", image: "quay.io/cilium/hubble-relay:v1.18.3", ports: [{ name: "grpc", port: 4245 }], usage: { cpu: 1, mem: 16 }, labels: k8sApp("hubble-relay"), ageHours: 1180 },
  { ns: "kube-system", workload: "hubble-ui", kind: "Deployment", container: "frontend", sidecars: ["backend"], image: "quay.io/cilium/hubble-ui:v0.13.3", ports: [{ name: "http", port: 8081 }], usage: { cpu: 1, mem: 22 }, labels: k8sApp("hubble-ui"), ageHours: 1180 },
  { ns: "kube-system", workload: "konnectivity-agent", kind: "Deployment", replicas: 2, container: "konnectivity-agent", image: "registry.k8s.io/kas-network-proxy/proxy-agent:v0.33.0", usage: { cpu: 2, mem: 17 }, labels: k8sApp("konnectivity-agent"), ageHours: 1180 },
  { ns: "kube-system", workload: "metrics-server", kind: "Deployment", container: "metrics-server", image: "registry.k8s.io/metrics-server/metrics-server:v0.8.1", ports: [{ name: "https", port: 10250 }], req: { cpu: "100m", memory: "200Mi" }, usage: { cpu: 4, mem: 25 }, labels: instance("metrics-server", "metrics-server"), ageHours: 1160, release: "metrics-server" },

  // --- rabbitmq / redis ---
  { ns: "rabbitmq-system", workload: "rabbitmq-cluster-operator", kind: "Deployment", container: "operator", image: "docker.io/rabbitmqoperator/cluster-operator:2.14.0", ports: [{ name: "metrics", port: 9782 }], req: { cpu: "200m", memory: "500Mi" }, lim: { cpu: "200m", memory: "500Mi" }, usage: { cpu: 3, mem: 23 }, labels: { "app.kubernetes.io/name": "rabbitmq-cluster-operator" }, ageHours: 990, restarts: 141 },
  { ns: "rabbitmq", workload: "rabbitmq-server", kind: "StatefulSet", container: "rabbitmq", image: "docker.io/library/rabbitmq:4.1-management", ports: [{ name: "amqp", port: 5672 }, { name: "management", port: 15672 }, { name: "prometheus", port: 15692 }], req: { cpu: "250m", memory: "512Mi" }, lim: { cpu: "500m", memory: "1Gi" }, usage: { cpu: 5, mem: 135 }, labels: { "app.kubernetes.io/name": "rabbitmq", "app.kubernetes.io/component": "rabbitmq" }, pvcs: ["persistence-rabbitmq-server-0"], secretVolumes: ["rabbitmq-default-user", "rabbitmq-erlang-cookie"], ageHours: 990 },
  { ns: "redis", workload: "redis", kind: "StatefulSet", container: "redis", image: "docker.io/library/redis:7.4", ports: [{ name: "redis", port: 6379 }], req: { cpu: "50m", memory: "128Mi" }, lim: { cpu: "250m", memory: "256Mi" }, usage: { cpu: 9, mem: 34 }, labels: { app: "redis" }, pvcs: ["data-redis-0"], ageHours: 960 },

  // --- reports / social listening ---
  { ns: "reports-testing", workload: "k8s-infra-reports-v2-dms-reports", kind: "Deployment", container: "dms-reports", image: "ghcr.io/wlddhq/dms-reports:k8s-infra", ports: [{ port: 8000 }], req: { cpu: "200m", memory: "384Mi" }, lim: { cpu: "500m", memory: "600Mi" }, usage: { cpu: 11, mem: 356 }, labels: { app: "dms", component: "reports", release: "k8s-infra-reports-v2-dms-reports" }, secretEnvFrom: ["reports-secret"], pullSecret: true, ageHours: 46, release: "k8s-infra-reports-v2-dms-reports", strategy: "RollingUpdate" },
  { ns: "social-listening-testing", workload: "k8s-setup-social-listening-sl-analytics", kind: "Deployment", container: "sl-analytics", image: "ghcr.io/wlddhq/sl-analytics:k8s-setup", ports: [{ port: 8000 }], req: { cpu: "300m", memory: "1536Mi" }, lim: { cpu: "2", memory: "2Gi" }, usage: { cpu: 72, mem: 756 }, labels: { app: "social-listening", component: "analytics", release: "k8s-setup-social-listening-sl-analytics" }, pullSecret: true, ageHours: 47, release: "k8s-setup-social-listening-sl-analytics", strategy: "RollingUpdate" },
  { ns: "social-listening-testing", workload: "k8s-setup-social-listening-sl-api", kind: "Deployment", container: "sl-api", image: "ghcr.io/wlddhq/sl-api:k8s-setup", ports: [{ port: 4000 }], req: { cpu: "50m", memory: "128Mi" }, lim: { cpu: "500m", memory: "256Mi" }, usage: { cpu: 4, mem: 93 }, labels: { app: "social-listening", component: "api", release: "k8s-setup-social-listening-sl-api" }, pullSecret: true, ageHours: 47, release: "k8s-setup-social-listening-sl-api", strategy: "RollingUpdate" },
  { ns: "social-listening-testing", workload: "k8s-setup-social-listening-sl-dash", kind: "Deployment", container: "sl-dash", image: "ghcr.io/wlddhq/sl-dash:k8s-setup", ports: [{ port: 3000 }], req: { cpu: "50m", memory: "128Mi" }, lim: { cpu: "500m", memory: "256Mi" }, usage: { cpu: 1, mem: 48 }, labels: { app: "social-listening", component: "dash", release: "k8s-setup-social-listening-sl-dash" }, pullSecret: true, ageHours: 47, release: "k8s-setup-social-listening-sl-dash", strategy: "RollingUpdate" },

];

// Broken on purpose so the UI's error states can be tested. Only included when requested (unit tests).
const DEMO_APPS: AppDef[] = [
  { ns: "demo-states", workload: "demo-crashloop", kind: "Deployment", container: "app", image: "ghcr.io/example/demo-crashloop:1.0", req: { cpu: "50m", memory: "64Mi" }, lim: { cpu: "100m", memory: "128Mi" }, usage: { cpu: 0, mem: 0 }, labels: { app: "demo", component: "crashloop" }, ageHours: 6, restarts: 7, state: "crashloop" },
  { ns: "demo-states", workload: "demo-pending", kind: "Deployment", container: "app", image: "ghcr.io/example/demo-pending:1.0", req: { cpu: "500m", memory: "64Gi" }, lim: { cpu: "1", memory: "64Gi" }, usage: { cpu: 0, mem: 0 }, labels: { app: "demo", component: "pending" }, ageHours: 2, state: "pending" },
  { ns: "demo-states", workload: "demo-report-job", kind: "Deployment", container: "job", image: "ghcr.io/example/demo-job:1.0", req: { cpu: "50m", memory: "64Mi" }, usage: { cpu: 0, mem: 0 }, labels: { app: "demo", component: "job" }, ageHours: 12, state: "completed" },
];

interface ServiceDef {
  ns: string;
  name: string;
  type?: string;
  selector?: Labels;
  ports: { name?: string; port: number; targetPort?: number | string; protocol?: string; nodePort?: number }[];
  clusterIp?: string;
  lb?: string;
  headless?: boolean;
  ageHours: number;
}

const SERVICES: ServiceDef[] = [
  { ns: "do-dms-staging", name: "do-dms-staging-dms-api", selector: dms("api", "do-dms-staging-dms-api"), ports: [{ port: 3001, targetPort: 3001 }], ageHours: 190 },
  { ns: "do-dms-staging", name: "do-dms-staging-dms-ui", selector: dms("ui", "do-dms-staging-dms-ui"), ports: [{ port: 3000, targetPort: 3000 }], ageHours: 190 },
  { ns: "infisical", name: "infisical-infisical-standalone-infisical", selector: instance("infisical-standalone", "infisical"), ports: [{ port: 8080, targetPort: 8080 }], ageHours: 1150 },
  { ns: "infisical", name: "postgresql", selector: instance("postgresql", "infisical"), ports: [{ name: "tcp-postgresql", port: 5432, targetPort: "tcp-postgresql" }], ageHours: 1150 },
  { ns: "infisical", name: "redis-master", selector: instance("redis", "infisical"), ports: [{ name: "tcp-redis", port: 6379, targetPort: "redis" }], ageHours: 1150 },
  { ns: "ingress-nginx", name: "ingress-nginx-controller", type: "LoadBalancer", selector: instance("ingress-nginx", "ingress-nginx"), ports: [{ name: "http", port: 80, targetPort: "http", nodePort: 32458 }, { name: "https", port: 443, targetPort: "https", nodePort: 30967 }], lb: LB_IP, ageHours: 1180 },
  { ns: "ingress-nginx", name: "ingress-nginx-controller-admission", selector: instance("ingress-nginx", "ingress-nginx"), ports: [{ name: "https-webhook", port: 443, targetPort: "webhook" }], ageHours: 1180 },
  { ns: "kube-system", name: "kube-dns", selector: k8sApp("kube-dns"), ports: [{ name: "dns", port: 53, protocol: "UDP" }, { name: "dns-tcp", port: 53 }, { name: "metrics", port: 9153 }], clusterIp: "10.109.0.10", ageHours: 1180 },
  { ns: "kube-system", name: "metrics-server", selector: instance("metrics-server", "metrics-server"), ports: [{ name: "https", port: 443, targetPort: "https" }], ageHours: 1160 },
  { ns: "kube-system", name: "hubble-relay", selector: k8sApp("hubble-relay"), ports: [{ port: 80, targetPort: "grpc" }], ageHours: 1180 },
  { ns: "kube-system", name: "hubble-ui", selector: k8sApp("hubble-ui"), ports: [{ port: 80, targetPort: 8081 }], ageHours: 1180 },
  { ns: "rabbitmq", name: "rabbitmq", selector: { "app.kubernetes.io/name": "rabbitmq" }, ports: [{ name: "amqp", port: 5672 }, { name: "management", port: 15672 }, { name: "prometheus", port: 15692 }], ageHours: 990 },
  { ns: "rabbitmq", name: "rabbitmq-nodes", selector: { "app.kubernetes.io/name": "rabbitmq" }, ports: [{ name: "epmd", port: 4369 }, { name: "cluster-rpc", port: 25672 }], headless: true, ageHours: 990 },
  { ns: "redis", name: "redis", selector: { app: "redis" }, ports: [{ name: "redis", port: 6379 }], ageHours: 960 },
  { ns: "reports-testing", name: "k8s-infra-reports-v2-dms-reports", selector: { app: "dms", component: "reports", release: "k8s-infra-reports-v2-dms-reports" }, ports: [{ port: 8000 }], ageHours: 46 },
  { ns: "social-listening-testing", name: "k8s-setup-social-listening-sl-api", selector: { app: "social-listening", component: "api", release: "k8s-setup-social-listening-sl-api" }, ports: [{ port: 4000 }], ageHours: 860 },
  { ns: "social-listening-testing", name: "k8s-setup-social-listening-sl-dash", selector: { app: "social-listening", component: "dash", release: "k8s-setup-social-listening-sl-dash" }, ports: [{ port: 3000 }], ageHours: 860 },
];

interface IngressDef {
  ns: string;
  name: string;
  host: string;
  service: string;
  port: number;
  tlsSecret: string;
  ageHours: number;
}

const INGRESSES: IngressDef[] = [
  { ns: "do-dms-staging", name: "do-dms-staging-dms-ui-ingress", host: "do-dms-staging.app-test.wldd.in", service: "do-dms-staging-dms-ui", port: 3000, tlsSecret: "do-dms-staging-dms-ui-tls", ageHours: 190 },
  { ns: "do-dms-staging", name: "do-dms-staging-dms-api-ingress", host: "do-dms-staging.api.app-test.wldd.in", service: "do-dms-staging-dms-api", port: 3001, tlsSecret: "do-dms-staging-dms-api-tls", ageHours: 190 },
  { ns: "infisical", name: "infisical-ingress", host: "secrets.app-test.wldd.in", service: "infisical-infisical-standalone-infisical", port: 8080, tlsSecret: "infisical-tls", ageHours: 1150 },
  { ns: "social-listening-testing", name: "k8s-setup-social-listening-sl-api", host: "sl-api.app-test.wldd.in", service: "k8s-setup-social-listening-sl-api", port: 4000, tlsSecret: "k8s-setup-social-listening-sl-api-tls", ageHours: 860 },
  { ns: "social-listening-testing", name: "k8s-setup-social-listening-sl-dash", host: "sl.app-test.wldd.in", service: "k8s-setup-social-listening-sl-dash", port: 3000, tlsSecret: "k8s-setup-social-listening-sl-dash-tls", ageHours: 860 },
];

const PVCS = [
  { ns: "infisical", name: "data-postgresql-0", size: "8Gi", ageHours: 1150 },
  { ns: "infisical", name: "redis-data-redis-master-0", size: "8Gi", ageHours: 1150 },
  { ns: "rabbitmq", name: "persistence-rabbitmq-server-0", size: "10Gi", ageHours: 990 },
  { ns: "redis", name: "data-redis-0", size: "1Gi", ageHours: 960 },
];

const DEMO_NAMESPACE = { name: "demo-states", ageHours: 24 };

const NAMESPACES: { name: string; ageHours: number }[] = [
  { name: "cert-manager", ageHours: 1160 },
  { name: "default", ageHours: 1190 },
  { name: "do-dms-staging", ageHours: 190 },
  { name: "infisical", ageHours: 1150 },
  { name: "infisical-operator", ageHours: 1130 },
  { name: "ingress-nginx", ageHours: 1180 },
  { name: "kube-node-lease", ageHours: 1190 },
  { name: "kube-public", ageHours: 1190 },
  { name: "kube-system", ageHours: 1190 },
  { name: "rabbitmq", ageHours: 990 },
  { name: "rabbitmq-system", ageHours: 990 },
  { name: "redis", ageHours: 960 },
  { name: "reports-testing", ageHours: 46 },
  { name: "social-listening-testing", ageHours: 860 },
];

export interface SampleCluster {
  connection: RawConnection;
  nodes: V1Node[];
  namespaces: V1Namespace[];
  pods: V1Pod[];
  services: V1Service[];
  ingresses: V1Ingress[];
  pvcs: V1PersistentVolumeClaim[];
  pvs: V1PersistentVolume[];
  deployments: V1Deployment[];
  statefulSets: V1StatefulSet[];
  daemonSets: V1DaemonSet[];
  events: CoreV1Event[];
  nodeMetrics: NodeMetric[];
  podMetrics: PodMetric[];
}

function qos(req?: Quantities, lim?: Quantities): string {
  if (!req?.cpu && !req?.memory && !lim?.cpu && !lim?.memory) return "BestEffort";
  if (req?.cpu && req?.memory && lim?.cpu === req.cpu && lim?.memory === req.memory) return "Guaranteed";
  return "Burstable";
}

export interface SampleOptions {
  /** Adds the `demo-states` namespace with a crash-looping, an unschedulable and a completed pod. */
  includeDemoStates?: boolean;
}

export function buildSampleCluster(now: number = Date.now(), options: SampleOptions = {}): SampleCluster {
  const apps = options.includeDemoStates ? [...APPS, ...DEMO_APPS] : APPS;
  const namespaceDefs = options.includeDemoStates ? [...NAMESPACES, DEMO_NAMESPACE] : NAMESPACES;
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR);
  let podIpCounter = 10;

  const pods: V1Pod[] = [];
  const events: CoreV1Event[] = [];
  const podMetrics: PodMetric[] = [];
  const deployments: V1Deployment[] = [];
  const statefulSets: V1StatefulSet[] = [];
  const daemonSets: V1DaemonSet[] = [];

  const addEvent = (pod: V1Pod, type: string, reason: string, message: string, component: string, hoursAgo: number, count = 1) => {
    events.push({
      metadata: { name: `${pod.metadata!.name}.${hashStr(`${reason}${pod.metadata!.name}`, 8)}`, namespace: pod.metadata!.namespace, creationTimestamp: at(hoursAgo) },
      involvedObject: { kind: "Pod", name: pod.metadata!.name, namespace: pod.metadata!.namespace, uid: pod.metadata!.uid },
      type,
      reason,
      message,
      count,
      firstTimestamp: at(hoursAgo),
      lastTimestamp: at(hoursAgo > 1 && count > 1 ? 0.05 : hoursAgo),
      source: { component },
      reportingComponent: component,
    } as CoreV1Event);
  };

  for (const def of apps) {
    const replicas = def.replicas ?? 1;
    const rs = hashStr(def.workload, 10);
    const requests: Record<string, string> = {};
    const limits: Record<string, string> = {};
    if (def.req?.cpu) requests.cpu = def.req.cpu;
    if (def.req?.memory) requests.memory = def.req.memory;
    if (def.lim?.cpu) limits.cpu = def.lim.cpu;
    if (def.lim?.memory) limits.memory = def.lim.memory;

    for (let r = 0; r < replicas; r += 1) {
      const podName =
        def.kind === "StatefulSet" ? `${def.workload}-${r}` : def.kind === "DaemonSet" ? `${def.workload}-${hashStr(`${def.workload}${r}`, 5)}` : `${def.workload}-${rs}-${hashStr(`${def.workload}${r}`, 5)}`;
      const podUid = uid(`pod/${def.ns}/${podName}`);
      podIpCounter += 1;
      const podIp = def.hostNetwork ? NODE_IP : `10.108.2.${podIpCounter}`;
      const created = at(def.ageHours);
      const started = new Date(created.getTime() + 20_000);

      const containerNames = [def.container, ...(def.sidecars ?? [])];
      const containers: V1Container[] = containerNames.map((name, idx) => {
        const main = idx === 0;
        const container: V1Container = {
          name,
          image: main ? def.image : `${def.image.split(":")[0]}-${name}:latest`,
          imagePullPolicy: "IfNotPresent",
          ports: main ? def.ports?.map((p) => ({ name: p.name, containerPort: p.port, protocol: p.protocol ?? "TCP" })) : undefined,
          resources: main ? { requests, limits } : {},
          env: main ? def.env : undefined,
          envFrom: main && def.secretEnvFrom ? def.secretEnvFrom.map((n) => ({ secretRef: { name: n } })) : undefined,
          volumeMounts: main
            ? [
                { name: "kube-api-access", mountPath: "/var/run/secrets/kubernetes.io/serviceaccount", readOnly: true },
                ...(def.pvcs ?? []).map((p) => ({ name: p, mountPath: "/data" })),
                ...(def.secretVolumes ?? []).map((s) => ({ name: s, mountPath: `/etc/${s}`, readOnly: true })),
              ]
            : undefined,
        };
        if (main && def.probes) {
          const httpGet = { path: def.probes.path ?? "/", port: def.probes.port as unknown as never };
          container.readinessProbe = { httpGet, initialDelaySeconds: 10, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3, successThreshold: 1 };
          container.livenessProbe = { httpGet, initialDelaySeconds: 20, periodSeconds: 20, timeoutSeconds: 5, failureThreshold: 3, successThreshold: 1 };
        }
        return container;
      });

      const pod: V1Pod = {
        metadata: {
          name: podName,
          namespace: def.ns,
          uid: podUid,
          creationTimestamp: created,
          labels: { ...def.labels, ...(def.kind === "Deployment" ? { "pod-template-hash": rs } : {}) },
          annotations: def.release ? { "meta.helm.sh/release-name": def.release, "meta.helm.sh/release-namespace": def.ns } : undefined,
          ownerReferences: [
            {
              apiVersion: "apps/v1",
              kind: def.kind === "Deployment" ? "ReplicaSet" : def.kind,
              name: def.kind === "Deployment" ? `${def.workload}-${rs}` : def.workload,
              uid: uid(`owner/${def.ns}/${def.workload}`),
              controller: true,
              blockOwnerDeletion: true,
            },
          ],
        },
        spec: {
          nodeName: def.state === "pending" ? undefined : NODE,
          serviceAccountName: def.serviceAccount ?? "default",
          restartPolicy: def.state === "completed" ? "OnFailure" : "Always",
          dnsPolicy: def.hostNetwork ? "ClusterFirstWithHostNet" : "ClusterFirst",
          hostNetwork: def.hostNetwork,
          schedulerName: "default-scheduler",
          priority: 0,
          terminationGracePeriodSeconds: 30,
          nodeSelector: { "kubernetes.io/os": "linux" },
          imagePullSecrets: def.pullSecret ? [{ name: "ghcr-pull-secret" }] : undefined,
          tolerations: [
            { key: "node.kubernetes.io/not-ready", operator: "Exists", effect: "NoExecute", tolerationSeconds: 300 },
            { key: "node.kubernetes.io/unreachable", operator: "Exists", effect: "NoExecute", tolerationSeconds: 300 },
          ],
          containers,
          volumes: [
            { name: "kube-api-access", projected: { sources: [{ serviceAccountToken: { path: "token", expirationSeconds: 3607 } }, { configMap: { name: "kube-root-ca.crt" } }] } },
            ...(def.pvcs ?? []).map((p) => ({ name: p, persistentVolumeClaim: { claimName: p } })),
            ...(def.secretVolumes ?? []).map((s) => ({ name: s, secret: { secretName: s } })),
            ...(def.configMapVolumes ?? []).map((c) => ({ name: c, configMap: { name: c } })),
          ],
        },
        status: {},
      };

      // --- status ---
      const readyCond = (status: string, reason?: string) => ({ type: "Ready", status, reason, lastTransitionTime: started });
      if (def.state === "pending") {
        pod.status = {
          phase: "Pending",
          qosClass: qos(def.req, def.lim),
          conditions: [
            {
              type: "PodScheduled",
              status: "False",
              reason: "Unschedulable",
              message: "0/1 nodes are available: 1 Insufficient memory. no new claims to deallocate, preemption: 0/1 nodes are available: 1 No preemption victims found for incoming pod.",
              lastTransitionTime: created,
            },
          ],
        };
        addEvent(pod, "Warning", "FailedScheduling", "0/1 nodes are available: 1 Insufficient memory. no new claims to deallocate, preemption: 0/1 nodes are available: 1 No preemption victims found for incoming pod.", "default-scheduler", def.ageHours, 22);
      } else {
        const containerStatuses = containers.map((c, idx) => {
          const image = c.image ?? def.image;
          const base = { name: c.name, image, imageID: `${image.split(":")[0]}@sha256:${hashStr(image, 64, "0123456789abcdef")}`, containerID: `containerd://${hashStr(`${podName}${c.name}`, 64, "0123456789abcdef")}` };
          if (def.state === "crashloop" && idx === 0) {
            return {
              ...base,
              ready: false,
              started: false,
              restartCount: def.restarts ?? 0,
              state: { waiting: { reason: "CrashLoopBackOff", message: `back-off 5m0s restarting failed container=${c.name} pod=${podName}_${def.ns}(${podUid})` } },
              lastState: { terminated: { exitCode: 1, reason: "Error", startedAt: at(0.1), finishedAt: at(0.099) } },
            };
          }
          if (def.state === "completed") {
            return { ...base, ready: false, started: false, restartCount: 0, state: { terminated: { exitCode: 0, reason: "Completed", startedAt: started, finishedAt: new Date(started.getTime() + 95_000) } } };
          }
          const restarts = idx === 0 ? def.restarts ?? 0 : 0;
          return {
            ...base,
            ready: true,
            started: true,
            restartCount: restarts,
            state: { running: { startedAt: started } },
            lastState: restarts > 0 ? { terminated: { exitCode: 1, reason: "Error", startedAt: at(def.ageHours), finishedAt: new Date(created.getTime() + 15_000) } } : {},
          };
        });
        const crash = def.state === "crashloop";
        const done = def.state === "completed";
        pod.status = {
          phase: done ? "Succeeded" : "Running",
          qosClass: qos(def.req, def.lim),
          hostIP: NODE_IP,
          hostIPs: [{ ip: NODE_IP }],
          podIP: podIp,
          podIPs: [{ ip: podIp }],
          startTime: created,
          conditions: [
            { type: "PodReadyToStartContainers", status: "True", lastTransitionTime: started },
            { type: "Initialized", status: "True", lastTransitionTime: created },
            readyCond(crash || done ? "False" : "True", crash ? "ContainersNotReady" : done ? "PodCompleted" : undefined),
            { type: "ContainersReady", status: crash || done ? "False" : "True", reason: crash ? "ContainersNotReady" : done ? "PodCompleted" : undefined, lastTransitionTime: started },
            { type: "PodScheduled", status: "True", lastTransitionTime: created },
          ],
          containerStatuses,
        };
        addEvent(pod, "Normal", "Scheduled", `Successfully assigned ${def.ns}/${podName} to ${NODE}`, "default-scheduler", def.ageHours);
        addEvent(pod, "Normal", "Pulled", `Container image "${def.image}" already present on machine`, "kubelet", def.ageHours);
        addEvent(pod, "Normal", "Created", `Container created`, "kubelet", def.ageHours);
        addEvent(pod, "Normal", "Started", `Container started`, "kubelet", def.ageHours);
        if (crash) addEvent(pod, "Warning", "BackOff", `Back-off restarting failed container ${def.container} in pod ${podName}_${def.ns}(${podUid})`, "kubelet", def.ageHours - 0.5, 41);
        if ((def.restarts ?? 0) > 0 && !crash) addEvent(pod, "Warning", "BackOff", `Back-off restarting failed container ${def.container}`, "kubelet", def.ageHours - 0.1, def.restarts);
      }

      pods.push(pod);

      if (def.state !== "pending") {
        const perContainerCpu = def.usage.cpu / containerNames.length;
        const perContainerMem = def.usage.mem / containerNames.length;
        podMetrics.push({
          metadata: { name: podName, namespace: def.ns, selfLink: "", creationTimestamp: new Date(now).toISOString() },
          timestamp: new Date(now).toISOString(),
          window: "15s",
          containers: containerNames.map((name) => ({ name, usage: { cpu: `${Math.round(perContainerCpu)}m`, memory: `${Math.round(perContainerMem * 1024)}Ki` } })),
        });
      }
    }

    // Workload objects
    const ready = def.state === "pending" ? 0 : def.state === "crashloop" ? 0 : replicas;
    const selector = { matchLabels: def.labels };
    const meta = { name: def.workload, namespace: def.ns, uid: uid(`owner/${def.ns}/${def.workload}`), creationTimestamp: at(def.ageHours), labels: def.labels, annotations: def.release ? { "meta.helm.sh/release-name": def.release } : undefined };
    const template = { metadata: { labels: def.labels }, spec: { containers: [{ name: def.container, image: def.image }] } };
    if (def.kind === "Deployment") {
      deployments.push({ metadata: meta, spec: { replicas, selector, template, strategy: { type: def.strategy ?? "RollingUpdate" } }, status: { replicas, readyReplicas: ready, availableReplicas: ready, updatedReplicas: replicas } } as V1Deployment);
    } else if (def.kind === "StatefulSet") {
      statefulSets.push({ metadata: meta, spec: { replicas, selector, template, serviceName: def.workload }, status: { replicas, readyReplicas: ready, currentReplicas: replicas } } as V1StatefulSet);
    } else {
      daemonSets.push({ metadata: meta, spec: { selector, template }, status: { desiredNumberScheduled: replicas, currentNumberScheduled: replicas, numberReady: ready, numberAvailable: ready, updatedNumberScheduled: replicas } } as V1DaemonSet);
    }
  }

  const services: V1Service[] = SERVICES.map((s, i) => ({
    metadata: { name: s.name, namespace: s.ns, uid: uid(`svc/${s.ns}/${s.name}`), creationTimestamp: at(s.ageHours), labels: s.selector },
    spec: {
      type: s.type ?? "ClusterIP",
      clusterIP: s.headless ? "None" : (s.clusterIp ?? `10.109.${20 + Math.floor(i / 8)}.${10 + i}`),
      selector: s.selector,
      ports: s.ports.map((p) => ({ name: p.name, port: p.port, targetPort: p.targetPort ?? p.port, protocol: p.protocol ?? "TCP", nodePort: p.nodePort })),
    },
    status: s.lb ? { loadBalancer: { ingress: [{ ip: s.lb }] } } : {},
  }));

  const ingresses: V1Ingress[] = INGRESSES.map((g) => ({
    metadata: { name: g.name, namespace: g.ns, uid: uid(`ing/${g.ns}/${g.name}`), creationTimestamp: at(g.ageHours), annotations: { "cert-manager.io/cluster-issuer": "letsencrypt-prod" } },
    spec: {
      ingressClassName: "nginx",
      tls: [{ hosts: [g.host], secretName: g.tlsSecret }],
      rules: [{ host: g.host, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: g.service, port: { number: g.port } } } }] } }],
    },
    status: { loadBalancer: { ingress: [{ ip: LB_IP }] } },
  }));

  const pvcs: V1PersistentVolumeClaim[] = PVCS.map((c) => ({
    metadata: { name: c.name, namespace: c.ns, uid: uid(`pvc/${c.ns}/${c.name}`), creationTimestamp: at(c.ageHours) },
    spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: c.size } }, storageClassName: "do-block-storage", volumeName: `pvc-${uid(`pv/${c.name}`)}`, volumeMode: "Filesystem" },
    status: { phase: "Bound", capacity: { storage: c.size }, accessModes: ["ReadWriteOnce"] },
  }));

  const pvs: V1PersistentVolume[] = PVCS.map((c) => ({
    metadata: { name: `pvc-${uid(`pv/${c.name}`)}`, uid: uid(`pvobj/${c.name}`), creationTimestamp: at(c.ageHours) },
    spec: { capacity: { storage: c.size }, accessModes: ["ReadWriteOnce"], persistentVolumeReclaimPolicy: "Delete", storageClassName: "do-block-storage", claimRef: { name: c.name, namespace: c.ns }, csi: { driver: "dobs.csi.digitalocean.com", volumeHandle: uid(`vol/${c.name}`) } },
    status: { phase: "Bound" },
  }));

  const node: V1Node = {
    metadata: {
      name: NODE,
      uid: uid(`node/${NODE}`),
      creationTimestamp: at(1.1),
      labels: {
        "kubernetes.io/hostname": NODE,
        "kubernetes.io/os": "linux",
        "kubernetes.io/arch": "amd64",
        "node.kubernetes.io/instance-type": "s-8vcpu-16gb",
        "topology.kubernetes.io/region": "blr1",
        "doks.digitalocean.com/managed": "true",
        "doks.digitalocean.com/node-pool": "wldd-16gb",
        "doks.digitalocean.com/version": "1.36.3-do.1",
      },
    },
    spec: { providerID: "digitalocean://100000001" },
    status: {
      capacity: { cpu: "8", memory: "16322340Ki", pods: "110", "ephemeral-storage": "330Gi" },
      allocatable: { cpu: "7820m", memory: "13550120Ki", pods: "110", "ephemeral-storage": "300Gi" },
      addresses: [{ type: "InternalIP", address: NODE_IP }, { type: "ExternalIP", address: NODE_EXTERNAL_IP }, { type: "Hostname", address: NODE }],
      conditions: [
        { type: "NetworkUnavailable", status: "False", reason: "CiliumIsUp", message: "Cilium is running on this node" },
        { type: "MemoryPressure", status: "False", reason: "KubeletHasSufficientMemory", message: "kubelet has sufficient memory available" },
        { type: "DiskPressure", status: "False", reason: "KubeletHasNoDiskPressure", message: "kubelet has no disk pressure" },
        { type: "PIDPressure", status: "False", reason: "KubeletHasSufficientPID", message: "kubelet has sufficient PID available" },
        { type: "Ready", status: "True", reason: "KubeletReady", message: "kubelet is posting ready status" },
      ],
      nodeInfo: { kubeletVersion: "v1.36.3", osImage: "Debian GNU/Linux 13 (trixie)", kernelVersion: "6.12.96+deb13-amd64", containerRuntimeVersion: "containerd://2.2.3", architecture: "amd64" } as V1NodeSystemInfo,
    },
  };

  const namespaces: V1Namespace[] = namespaceDefs.map((n) => ({
    metadata: { name: n.name, uid: uid(`ns/${n.name}`), creationTimestamp: at(n.ageHours), labels: { "kubernetes.io/metadata.name": n.name } },
    status: { phase: "Active" },
  }));

  return {
    connection: {
      contextName: "do-blr1-wldd (sample)",
      clusterName: "do-blr1-wldd (sample)",
      server: "https://sample-cluster.k8s.ondigitalocean.com",
      userName: "do-blr1-wldd-admin (sample)",
      version: "v1.36.3",
      platform: "linux/amd64",
      reachable: true,
    },
    nodes: [node],
    namespaces,
    pods,
    services,
    ingresses,
    pvcs,
    pvs,
    deployments,
    statefulSets,
    daemonSets,
    events,
    nodeMetrics: [{ metadata: { name: NODE, selfLink: "", creationTimestamp: new Date(now).toISOString() }, timestamp: new Date(now).toISOString(), window: "20s", usage: { cpu: "444m", memory: "4864000Ki" } }],
    podMetrics,
  };
}
