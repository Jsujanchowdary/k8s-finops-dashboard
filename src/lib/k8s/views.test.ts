import { beforeAll, describe, expect, it } from "vitest";
import type { V1Pod } from "@kubernetes/client-node";
import { buildSampleCluster } from "@/test/sample-cluster";
import {
  buildIngressViews,
  buildNamespaceViews,
  buildNodeViews,
  buildPodDetail,
  buildPodRows,
  buildPvcViews,
  buildServiceViews,
  commitOf,
  conditionHealth,
  buildWorkloads,
  podResourceTotals,
  podStatus,
  resourceTotals,
  type RawBundle,
} from "./views";

let bundle: RawBundle;
// The sample cluster's "now". Anything measured against the clock ("warnings in the last day") must use it too.
const SAMPLE_NOW = Date.UTC(2026, 9, 8);

beforeAll(() => {
  const c = buildSampleCluster(SAMPLE_NOW, { includeDemoStates: true });
  bundle = {
    nodes: c.nodes, namespaces: c.namespaces, pods: c.pods, services: c.services, ingresses: c.ingresses, pvcs: c.pvcs, pvs: c.pvs,
    deployments: c.deployments, statefulSets: c.statefulSets, daemonSets: c.daemonSets, events: c.events, nodeMetrics: c.nodeMetrics, podMetrics: c.podMetrics,
  };
});

describe("podStatus", () => {
  it("shows CrashLoopBackOff as critical", () => {
    const rows = buildPodRows(bundle);
    const crash = rows.find((r) => r.name.startsWith("demo-crashloop"))!;
    expect(crash.status).toBe("CrashLoopBackOff");
    expect(crash.health).toBe("critical");
    expect(crash.ready).toBe("0/1");
    expect(crash.restarts).toBe(7);
  });

  it("shows unschedulable pods as warning", () => {
    const pending = buildPodRows(bundle).find((r) => r.name.startsWith("demo-pending"))!;
    expect(pending.status).toBe("Unschedulable");
    expect(pending.health).toBe("warning");
    expect(pending.nodeName).toBeUndefined();
    expect(pending.cpu.usage).toBeNull();
  });

  it("treats completed pods as healthy", () => {
    const done = buildPodRows(bundle).find((r) => r.name.startsWith("demo-report-job"))!;
    expect(done.status).toBe("Completed");
    expect(done.health).toBe("healthy");
  });

  it("reports a failing init container", () => {
    const pod = {
      metadata: { name: "x", namespace: "n" },
      spec: { initContainers: [{ name: "i" }], containers: [{ name: "c" }] },
      status: { phase: "Pending", initContainerStatuses: [{ name: "i", ready: false, restartCount: 3, image: "", imageID: "", state: { waiting: { reason: "CrashLoopBackOff" } } }] },
    } as unknown as V1Pod;
    expect(podStatus(pod)).toEqual({ status: "Init:CrashLoopBackOff", health: "critical" });
  });

  it("shows Terminating when a deletion timestamp is set", () => {
    const pod = { metadata: { deletionTimestamp: new Date() }, spec: { containers: [] }, status: { phase: "Running", containerStatuses: [] } } as unknown as V1Pod;
    expect(podStatus(pod).status).toBe("Terminating");
  });
});

describe("resources", () => {
  it("sums container requests and limits for a pod", () => {
    const pod = {
      spec: { containers: [{ name: "a", resources: { requests: { cpu: "100m", memory: "64Mi" }, limits: { cpu: "1", memory: "128Mi" } } }, { name: "b", resources: { requests: { cpu: "50m" } } }] },
    } as unknown as V1Pod;
    const t = podResourceTotals(pod);
    expect(t.cpuRequest).toBeCloseTo(0.15);
    expect(t.cpuLimit).toBe(1);
    expect(t.memRequest).toBe(64 * 1024 ** 2);
    expect(t.memLimit).toBe(128 * 1024 ** 2);
  });

  it("uses the largest init container when it exceeds the app containers", () => {
    const pod = {
      spec: { initContainers: [{ name: "i", resources: { requests: { cpu: "2" } } }], containers: [{ name: "a", resources: { requests: { cpu: "100m" } } }] },
    } as unknown as V1Pod;
    expect(podResourceTotals(pod).cpuRequest).toBe(2);
  });

  it("resourceTotals tolerates rows without usage", () => {
    const rows = buildPodRows(bundle);
    const total = resourceTotals(rows);
    expect(total.cpu.usage).not.toBeNull();
    expect(total.memory.request).toBeGreaterThan(0);
  });
});

describe("nodes", () => {
  it("aggregates requests and usage per node and ignores unscheduled/terminated pods", () => {
    const [node] = buildNodeViews(bundle);
    expect(node.name).toBe("wldd-16gb-3oj16x");
    expect(node.status).toBe("Ready");
    expect(node.instanceType).toBe("s-8vcpu-16gb");
    expect(node.region).toBe("blr1");
    expect(node.nodePool).toBe("wldd-16gb");
    expect(node.cpu.capacity).toBe(8);
    expect(node.cpu.usage).toBeCloseTo(0.444);
    const running = bundle.pods.filter((p) => p.spec?.nodeName === node.name && p.status?.phase !== "Succeeded");
    expect(node.pods.count).toBe(running.length);
    expect(node.cpu.requests).toBeGreaterThan(1);
    expect(node.externalIp).toBe("203.0.113.10");
  });

  it("marks cordoned nodes", () => {
    const cordoned = { ...bundle, nodes: [{ ...bundle.nodes[0], spec: { ...bundle.nodes[0].spec, unschedulable: true } }] };
    expect(buildNodeViews(cordoned)[0].status).toBe("Ready,SchedulingDisabled");
  });
});

describe("commitOf", () => {
  const pod = (labels: Record<string, string> | undefined, image: string) => ({ metadata: { labels }, spec: { containers: [{ name: "c", image }] } }) as unknown as V1Pod;

  it("prefers the commit label the charts set", () => {
    expect(commitOf(pod({ commit: "438a32bdeadbeef" }, "ghcr.io/x/api:do-dms-staging-78669a5"))).toBe("438a32bdeadbeef");
  });
  it("falls back to the hash at the end of the image tag when the label is unknown or missing", () => {
    expect(commitOf(pod({ commit: "unknown" }, "ghcr.io/wlddhq/dms-api:do-dms-staging-438a32b"))).toBe("438a32b");
    expect(commitOf(pod(undefined, "ghcr.io/wlddhq/dms-ui:main-78669a5f"))).toBe("78669a5f");
  });
  it("returns nothing for images that carry no commit", () => {
    expect(commitOf(pod(undefined, "ghcr.io/wlddhq/dms-tally:k8s-infra"))).toBeUndefined();
    expect(commitOf(pod(undefined, "quay.io/jetstack/cert-manager-controller:v1.21.1"))).toBeUndefined();
    expect(commitOf(pod(undefined, "nginx"))).toBeUndefined();
  });
  it("shows up on the sample cluster's app pods and not on system pods", () => {
    const rows = buildPodRows(bundle);
    expect(rows.find((r) => r.name.startsWith("do-dms-staging-dms-api"))?.commit).toBe("438a32b");
    expect(rows.find((r) => r.name.startsWith("cilium"))?.commit).toBeUndefined();
  });
});

describe("node conditions", () => {
  it("treats True as healthy for Ready-style conditions, including DOKS custom ones", () => {
    expect(conditionHealth("Ready", "True")).toBe("healthy");
    expect(conditionHealth("Ready", "False")).toBe("critical");
    expect(conditionHealth("doks.kubernetes.io/CiliumAgentReady", "True")).toBe("healthy");
    expect(conditionHealth("doks.kubernetes.io/CiliumAgentReady", "False")).toBe("critical");
  });

  it("treats True as a problem for pressure and unavailable conditions", () => {
    for (const type of ["MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable"]) {
      expect(conditionHealth(type, "True"), type).toBe("critical");
      expect(conditionHealth(type, "False"), type).toBe("healthy");
    }
  });

  it("flags Unknown and leaves unrecognised conditions neutral", () => {
    expect(conditionHealth("Ready", "Unknown")).toBe("warning");
    expect(conditionHealth("SomethingCustom", "True")).toBe("unknown");
  });

  it("marks the real node's conditions healthy in the sample cluster", () => {
    const [node] = buildNodeViews(bundle);
    expect(node.conditions.every((c) => c.health === "healthy")).toBe(true);
  });
});

describe("namespaces", () => {
  it("summarises each namespace", () => {
    const rows = buildPodRows(bundle);
    const namespaces = buildNamespaceViews(bundle, rows, SAMPLE_NOW);
    const byName = Object.fromEntries(namespaces.map((n) => [n.name, n]));
    expect(byName["do-dms-staging"].pods.total).toBe(3);
    expect(byName["do-dms-staging"].health).toBe("healthy");
    expect(byName["do-dms-staging"].counts).toMatchObject({ deployments: 3, services: 2, ingresses: 2 });
    expect(byName["do-dms-staging"].hosts).toContain("do-dms-staging.app-test.wldd.in");
    expect(byName["demo-states"].health).toBe("critical");
    expect(byName["demo-states"].warningEvents).toBeGreaterThan(0);
    expect(byName["default"].health).toBe("unknown");
    expect(byName["infisical"].storageBytes).toBe(16 * 1024 ** 3);
    expect(namespaces.map((n) => n.name)).toEqual([...namespaces.map((n) => n.name)].sort());
  });
});

describe("workloads, services, ingresses, storage", () => {
  it("lists workloads with ready counts", () => {
    const workloads = buildWorkloads(bundle, "demo-states");
    expect(workloads.find((w) => w.name === "demo-crashloop")).toMatchObject({ ready: "0/1", health: "critical" });
    const kube = buildWorkloads(bundle, "kube-system");
    expect(kube.find((w) => w.name === "coredns")?.ready).toBe("2/2");
    expect(kube.some((w) => w.kind === "DaemonSet")).toBe(true);
  });

  it("links services to their ingresses", () => {
    const api = buildServiceViews(bundle, "do-dms-staging").find((s) => s.name === "do-dms-staging-dms-api")!;
    expect(api.ingresses.map((i) => i.hosts[0])).toEqual(["do-dms-staging.api.app-test.wldd.in"]);
    expect(buildIngressViews(bundle, "do-dms-staging")).toHaveLength(2);
    const lb = buildServiceViews(bundle, "ingress-nginx").find((s) => s.type === "LoadBalancer")!;
    expect(lb.loadBalancer).toEqual(["203.0.113.50"]);
  });

  it("maps PVCs to the pods that use them", () => {
    const pvc = buildPvcViews(bundle, "infisical").find((p) => p.name === "data-postgresql-0")!;
    expect(pvc.usedBy).toEqual(["postgresql-0"]);
    expect(pvc.capacityBytes).toBe(8 * 1024 ** 3);
    expect(pvc.status).toBe("Bound");
  });
});

describe("pod detail", () => {
  const apiPodName = () => bundle.pods.find((p) => p.metadata?.name?.startsWith("do-dms-staging-dms-api"))!.metadata!.name!;

  it("returns null for unknown pods", () => {
    expect(buildPodDetail(bundle, "nope", "nope")).toBeNull();
  });

  it("includes containers, probes, resources, network and events", () => {
    const d = buildPodDetail(bundle, "do-dms-staging", apiPodName())!;
    expect(d.row.status).toBe("Running");
    const c = d.containers[0];
    expect(c.image).toContain("dms-api");
    expect(c.resources.memory.limit).toBe(512 * 1024 ** 2);
    expect(c.resources.memory.usage).toBeGreaterThan(0);
    expect(c.probes.map((p) => p.kind)).toEqual(["liveness", "readiness"]);
    expect(c.envFrom).toEqual([{ kind: "secret", name: "dms-secret", prefix: undefined, optional: undefined }]);
    expect(d.network.podIp).toMatch(/^10\.108\./);
    expect(d.network.ports).toEqual([{ container: "dms-api", name: undefined, port: 3001, protocol: "TCP" }]);
    expect(d.network.services.map((s) => s.name)).toEqual(["do-dms-staging-dms-api"]);
    expect(d.network.services[0].ingresses[0].tls[0].secretName).toBe("do-dms-staging-dms-api-tls");
    expect(d.owners.some((o) => o.kind === "Deployment" && o.name === "do-dms-staging-dms-api")).toBe(true);
    expect(d.security.imagePullSecrets).toEqual(["ghcr-pull-secret"]);
    expect(d.events.length).toBeGreaterThan(0);
    expect(d.row.release).toBe("do-dms-staging-dms-api");
  });

  it("shows literal environment values as set, and references by name", () => {
    const ui = bundle.pods.find((p) => p.metadata?.name?.startsWith("do-dms-staging-dms-ui"))!;
    const d = buildPodDetail(bundle, "do-dms-staging", ui.metadata!.name!)!;
    const literal = ui.spec!.containers[0].env!.find((e) => e.value)!;
    expect(d.containers[0].env.find((e) => e.name === literal.name)).toEqual({ name: literal.name, source: "literal", value: literal.value });
    expect(JSON.stringify(d.raw)).toContain(literal.value!);
  });

  it("shows secret references by name only", () => {
    const tally = bundle.pods.find((p) => p.metadata?.name?.startsWith("do-dms-staging-dms-tally"))!;
    const d = buildPodDetail(bundle, "do-dms-staging", tally.metadata!.name!)!;
    expect(d.containers[0].env).toContainEqual({ name: "MQ_URL", source: "secret", ref: "dms-secret/RABBITMQ_URL" });
    expect(d.row.restarts).toBe(5);
  });

  it("describes PVC-backed volumes", () => {
    const d = buildPodDetail(bundle, "infisical", "postgresql-0")!;
    const pvc = d.volumes.find((v) => v.type === "pvc")!;
    expect(pvc.source).toBe("data-postgresql-0");
    expect(pvc.pvc?.capacityBytes).toBe(8 * 1024 ** 3);
  });

  it("explains an unschedulable pod", () => {
    const pending = bundle.pods.find((p) => p.metadata?.name?.startsWith("demo-pending"))!;
    const d = buildPodDetail(bundle, "demo-states", pending.metadata!.name!)!;
    expect(d.conditions.find((c) => c.type === "PodScheduled")?.reason).toBe("Unschedulable");
    expect(d.events[0].reason).toBe("FailedScheduling");
    expect(d.network.podIp).toBeUndefined();
  });
});

describe("test fixture", () => {
  it("does not include the demo namespace unless asked", () => {
    const plain = buildSampleCluster(Date.UTC(2026, 9, 8));
    expect(plain.namespaces.map((n) => n.metadata?.name)).not.toContain("demo-states");
    expect(plain.pods.some((p) => p.metadata?.namespace === "demo-states")).toBe(false);
    const withDemo = buildSampleCluster(Date.UTC(2026, 9, 8), { includeDemoStates: true });
    expect(withDemo.namespaces.map((n) => n.metadata?.name)).toContain("demo-states");
  });
});
