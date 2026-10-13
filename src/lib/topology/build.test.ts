import { beforeAll, describe, expect, it } from "vitest";
import { buildSampleCluster } from "@/test/sample-cluster";
import { buildPodRows, type RawBundle } from "@/lib/k8s/views";
import { buildTopology, selectorMatches } from "./build";
import { layoutTopology } from "./layout";
import { factHeight, nodeSize, titleLines } from "./sizes";
import { tracePath } from "./trace";
import type { TopoNode, Topology } from "./types";

let bundle: RawBundle;
let staging: Topology;

function topologyOf(b: RawBundle, namespace: string): Topology {
  return buildTopology(b, buildPodRows(b), namespace);
}

beforeAll(() => {
  const c = buildSampleCluster(Date.UTC(2026, 9, 8), { includeDemoStates: true });
  bundle = {
    nodes: c.nodes, namespaces: c.namespaces, pods: c.pods, services: c.services, ingresses: c.ingresses, pvcs: c.pvcs, pvs: c.pvs,
    deployments: c.deployments, statefulSets: c.statefulSets, daemonSets: c.daemonSets, events: c.events, nodeMetrics: c.nodeMetrics, podMetrics: c.podMetrics,
  };
  staging = topologyOf(bundle, "do-dms-staging");
});

const edge = (t: Topology, from: string, to: string) => t.edges.find((e) => e.from === from && (e.toPod ?? e.to) === to || e.from === from && e.to === to);
const ids = (t: Topology, kind: string) => t.nodes.filter((n) => n.kind === kind).map((n) => n.id);

describe("selectorMatches", () => {
  it("handles matchLabels and expressions, and never matches an empty selector", () => {
    const labels = { app: "dms", tier: "web" };
    expect(selectorMatches({ matchLabels: { app: "dms" } }, labels)).toBe(true);
    expect(selectorMatches({ matchLabels: { app: "other" } }, labels)).toBe(false);
    expect(selectorMatches({ matchExpressions: [{ key: "tier", operator: "In", values: ["web", "api"] }] }, labels)).toBe(true);
    expect(selectorMatches({ matchExpressions: [{ key: "tier", operator: "NotIn", values: ["web"] }] }, labels)).toBe(false);
    expect(selectorMatches({ matchExpressions: [{ key: "gone", operator: "DoesNotExist" }] }, labels)).toBe(true);
    expect(selectorMatches({}, labels)).toBe(false);
    expect(selectorMatches(undefined, labels)).toBe(false);
  });
});

describe("buildTopology: the public path", () => {
  it("draws Internet, load balancer, controller, ingresses, services and pods in order", () => {
    expect(ids(staging, "internet")).toEqual(["internet"]);
    expect(ids(staging, "loadbalancer")).toHaveLength(1);
    expect(ids(staging, "controller")).toHaveLength(1);
    expect(ids(staging, "ingress")).toEqual(["ing:do-dms-staging/do-dms-staging-dms-api-ingress", "ing:do-dms-staging/do-dms-staging-dms-ui-ingress"]);

    const lb = ids(staging, "loadbalancer")[0];
    const controller = ids(staging, "controller")[0];
    expect(edge(staging, "internet", lb)).toBeDefined();
    expect(edge(staging, lb, controller)?.label).toBe("80, 443");
    expect(edge(staging, controller, "ing:do-dms-staging/do-dms-staging-dms-ui-ingress")).toBeDefined();
    expect(edge(staging, "ing:do-dms-staging/do-dms-staging-dms-ui-ingress", "svc:do-dms-staging/do-dms-staging-dms-ui")?.label).toBe("/");
  });

  it("shows images without the registry host or the digest", () => {
    const patched: RawBundle = {
      ...bundle,
      pods: bundle.pods.map((p) =>
        p.metadata?.namespace === "ingress-nginx" ? { ...p, spec: { ...p.spec!, containers: p.spec!.containers.map((c) => ({ ...c, image: `registry.k8s.io/ingress-nginx/controller:v1.15.1@sha256:${"ab".repeat(32)}` })) } } : p,
      ),
    };
    const controller = topologyOf(patched, "do-dms-staging").nodes.find((n) => n.kind === "controller")!;
    expect(controller.facts.find((f) => f.label === "Image")?.value).toBe("ingress-nginx/controller:v1.15.1");
  });

  it("marks the load balancer and the controller as the entry, with the controller outside this namespace", () => {
    const controller = staging.nodes.find((n) => n.kind === "controller")!;
    expect(controller.foreign).toBe(true);
    expect(controller.facts.find((f) => f.label === "Namespace")?.value).toBe("ingress-nginx");
    expect(controller.health).toBe("healthy");
  });

  it("connects each service to exactly the pods its selector picks, one edge per pod", () => {
    const apiPods = staging.nodes.find((n) => n.id.endsWith("/Deployment/do-dms-staging-dms-api"))!.pods!;
    const fromApiService = staging.edges.filter((e) => e.from === "svc:do-dms-staging/do-dms-staging-dms-api" && e.toPod);
    expect(fromApiService.map((e) => e.toPod)).toEqual(apiPods.map((p) => p.id));
    expect(fromApiService.every((e) => e.active)).toBe(true);
    expect(staging.edges.some((e) => e.from === "svc:do-dms-staging/do-dms-staging-dms-api" && e.toPod?.includes("-ui-"))).toBe(false);
  });
});

describe("buildTopology: workloads and pods", () => {
  it("groups pods under their Deployment and shows image, release and per-pod details", () => {
    const api = staging.nodes.find((n) => n.id.endsWith("/Deployment/do-dms-staging-dms-api"))!;
    expect(api.kind).toBe("workload");
    expect(api.subtitle).toBe("Deployment · 1/1 ready");
    expect(api.facts.find((f) => f.label === "Image")?.value).toBe("wlddhq/dms-api:do-dms-staging-438a32b");
    expect(api.pods).toHaveLength(1);
    expect(api.pods![0]).toMatchObject({ status: "Running", ready: "1/1", inService: true, health: "healthy" });
    expect(api.pods![0].href).toMatch(/^\/namespaces\/do-dms-staging\/pods\/do-dms-staging-dms-api-/);
  });

  it("flags a crash-looping pod as not in service and its edge as inactive", () => {
    const demo = topologyOf(bundle, "demo-states");
    const crash = demo.nodes.flatMap((n) => n.pods ?? []).find((p) => p.name.startsWith("demo-crashloop"))!;
    expect(crash.health).toBe("critical");
    expect(crash.inService).toBe(false);
    const workload = demo.nodes.find((n) => n.pods?.some((p) => p.id === crash.id))!;
    expect(workload.health).toBe("critical");
  });

  it("leaves completed pods out and says so", () => {
    const demo = topologyOf(bundle, "demo-states");
    expect(demo.nodes.flatMap((n) => n.pods ?? []).some((p) => p.status === "Completed")).toBe(false);
    expect(demo.notes.join(" ")).toMatch(/completed pod/);
  });
});

describe("buildTopology: configured links", () => {
  it("links the UI to the API Service from its literal environment values, as a config edge", () => {
    const ui = staging.nodes.find((n) => n.id.endsWith("/Deployment/do-dms-staging-dms-ui"))!;
    const link = staging.edges.find((e) => e.kind === "config" && e.from === ui.id && e.to === "svc:do-dms-staging/do-dms-staging-dms-api");
    expect(link).toBeDefined();
    expect(link!.label).toMatch(/API_ENDPOINT_INTERNAL \+1/);
  });

  it("does not invent links for values that live in Secrets, and says they are not read", () => {
    const tally = staging.nodes.find((n) => n.id.endsWith("/Deployment/do-dms-staging-dms-tally"))!;
    expect(staging.edges.some((e) => e.kind === "config" && e.from === tally.id)).toBe(false);
    expect(staging.notes.join(" ")).toMatch(/Secrets or ConfigMaps/);
  });

  it("shows a database outside the cluster by host only, never with its credentials", () => {
    const patched: RawBundle = {
      ...bundle,
      pods: bundle.pods.map((p) =>
        p.metadata?.name?.startsWith("do-dms-staging-dms-api-")
          ? { ...p, spec: { ...p.spec!, containers: p.spec!.containers.map((c, i) => (i === 0 ? { ...c, env: [{ name: "DB_URL", value: "mongodb+srv://admin:s3cretPass@cluster0.ab12c.mongodb.net/dms" }] } : c)) } }
          : p,
      ),
    };
    const topo = topologyOf(patched, "do-dms-staging");
    const db = topo.nodes.find((n) => n.kind === "external")!;
    expect(db.title).toBe("cluster0.ab12c.mongodb.net");
    expect(db.subtitle).toBe("Database");
    expect(db.tags).toContain("Outside the cluster");
    expect(topo.edges.some((e) => e.kind === "config" && e.to === db.id && e.label === "DB_URL")).toBe(true);
    expect(JSON.stringify(topo)).not.toMatch(/s3cretPass|admin:/);
  });

  it("points a workload that calls a public URL of this namespace at the matching Ingress", () => {
    const patched: RawBundle = {
      ...bundle,
      pods: bundle.pods.map((p) =>
        p.metadata?.name?.startsWith("do-dms-staging-dms-api-")
          ? { ...p, spec: { ...p.spec!, containers: p.spec!.containers.map((c, i) => (i === 0 ? { ...c, env: [{ name: "PUBLIC_UI", value: "https://do-dms-staging.app-test.wldd.in/login" }] } : c)) } }
          : p,
      ),
    };
    const topo = topologyOf(patched, "do-dms-staging");
    expect(topo.nodes.some((n) => n.kind === "external")).toBe(false);
    expect(topo.edges.some((e) => e.kind === "config" && e.to === "ing:do-dms-staging/do-dms-staging-dms-ui-ingress")).toBe(true);
  });

  it("reaches Services in other namespaces and marks them as foreign", () => {
    const patched: RawBundle = {
      ...bundle,
      pods: bundle.pods.map((p) =>
        p.metadata?.name?.startsWith("do-dms-staging-dms-api-")
          ? { ...p, spec: { ...p.spec!, containers: p.spec!.containers.map((c, i) => (i === 0 ? { ...c, env: [{ name: "AMQP", value: "amqp://guest:guest@rabbitmq.rabbitmq.svc.cluster.local:5672" }] } : c)) } }
          : p,
      ),
    };
    const topo = topologyOf(patched, "do-dms-staging");
    const rabbit = topo.nodes.find((n) => n.id === "svc:rabbitmq/rabbitmq")!;
    expect(rabbit.foreign).toBe(true);
    expect(rabbit.subtitle).toContain("rabbitmq");
    expect(JSON.stringify(topo)).not.toContain("guest:guest");
  });
});

describe("buildTopology: storage, missing backends and quiet namespaces", () => {
  it("draws a StatefulSet's volume as a mount", () => {
    const infisical = topologyOf(bundle, "infisical");
    const pvc = infisical.nodes.find((n) => n.id === "pvc:infisical/data-postgresql-0")!;
    expect(pvc).toMatchObject({ kind: "pvc", health: "healthy" });
    expect(pvc.facts.find((f) => f.label === "Size")?.value).toBe("8Gi");
    const mount = infisical.edges.find((e) => e.kind === "mount" && e.to === pvc.id)!;
    expect(mount.from).toMatch(/StatefulSet\/postgresql$/);
  });

  it("draws an Ingress that points at a Service that does not exist as a missing backend", () => {
    const patched: RawBundle = { ...bundle, services: bundle.services.filter((s) => s.metadata?.name !== "do-dms-staging-dms-ui") };
    const topo = topologyOf(patched, "do-dms-staging");
    const missing = topo.nodes.find((n) => n.id === "svc:do-dms-staging/do-dms-staging-dms-ui")!;
    expect(missing).toMatchObject({ missing: true, health: "critical" });
  });

  it("gives a namespace with nothing public no Internet node", () => {
    const rabbit = topologyOf(bundle, "rabbitmq");
    expect(rabbit.nodes.some((n) => n.kind === "internet")).toBe(false);
    expect(rabbit.nodes.some((n) => n.kind === "workload")).toBe(true);
  });

  it("builds an empty diagram for an empty namespace", () => {
    expect(topologyOf(bundle, "kube-public")).toMatchObject({ nodes: [], edges: [] });
  });
});

describe("layoutTopology", () => {
  it("lays the request path out from left to right without overlapping cards", () => {
    const laid = layoutTopology(staging);
    const at = (id: string) => laid.nodes.find((n) => n.id === id)!;
    const lb = at(ids(staging, "loadbalancer")[0]);
    const ctl = at(ids(staging, "controller")[0]);
    const ing = at("ing:do-dms-staging/do-dms-staging-dms-ui-ingress");
    const svc = at("svc:do-dms-staging/do-dms-staging-dms-ui");
    const ui = laid.nodes.find((n) => n.id.endsWith("/Deployment/do-dms-staging-dms-ui"))!;
    expect(at("internet").x).toBeLessThan(lb.x);
    expect(lb.x).toBeLessThan(ctl.x);
    expect(ctl.x).toBeLessThan(ing.x);
    expect(ing.x).toBeLessThan(svc.x);
    expect(svc.x).toBeLessThan(ui.x);

    for (const a of laid.nodes) {
      for (const b of laid.nodes) {
        if (a.id >= b.id) continue;
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
    expect(laid.width).toBeGreaterThan(0);
    expect(laid.height).toBeGreaterThan(0);
  });

  it("sizes a workload card by its pod count", () => {
    const pods = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) as never;
    const base: Pick<TopoNode, "kind" | "title" | "tags" | "health" | "facts"> = { kind: "workload", title: "api", tags: [], health: "healthy", facts: [] };
    const one = nodeSize({ ...base, pods: pods(1) });
    const three = nodeSize({ ...base, pods: pods(3) });
    expect(three.height).toBeGreaterThan(one.height);
    expect(nodeSize({ ...base, pods: [] }).height).toBe(one.height);
  });

  it("gives long names and values room to wrap instead of cutting them off", () => {
    const short: Pick<TopoNode, "kind" | "title" | "tags" | "health" | "facts" | "pods"> = { kind: "ingress", title: "web", tags: ["TLS"], health: "unknown", facts: [{ label: "Host", value: "web.example.in", mono: true }], pods: undefined };
    const long = { ...short, title: "k8s-setup-social-listening-sl-analytics-ingress", facts: [{ label: "Host", value: "k8s-setup-social-listening-analytics.app-test.wldd.in", mono: true }] };
    expect(nodeSize(long).height).toBeGreaterThan(nodeSize(short).height);
    expect(titleLines(short)).toBe(1);
    expect(titleLines(long)).toBeGreaterThan(1);
    expect(factHeight("ingress", long.facts[0])).toBeGreaterThan(factHeight("ingress", short.facts[0]));
  });
});

describe("layout details", () => {
  it("leaves headless Services out of the diagram and says so", () => {
    const topo = topologyOf(bundle, "rabbitmq");
    expect(topo.nodes.some((n) => n.id === "svc:rabbitmq/rabbitmq-nodes")).toBe(false);
    expect(topo.nodes.some((n) => n.id === "svc:rabbitmq/rabbitmq")).toBe(true);
    expect(topo.notes.join(" ")).toMatch(/headless Service is not drawn/);
  });

  it("puts a configured link to something already on the request path in no column of its own", () => {
    const laid = layoutTopology(staging);
    const at = (id: string) => laid.nodes.find((n) => n.id === id)!;
    // The UI calls the API's Service, but the API chain still sits in the same columns as the UI chain.
    expect(at("svc:do-dms-staging/do-dms-staging-dms-api").x).toBe(at("svc:do-dms-staging/do-dms-staging-dms-ui").x);
  });

  it("places workloads nothing connects to in a block below the connected diagram", () => {
    const laid = layoutTopology(staging);
    const tally = laid.nodes.find((n) => n.id.endsWith("/Deployment/do-dms-staging-dms-tally"))!;
    const connected = laid.nodes.filter((n) => n.id !== tally.id);
    expect(tally.y).toBeGreaterThanOrEqual(Math.max(...connected.map((n) => n.y + n.height)));
    // A namespace where nothing is connected still lays out inside the canvas.
    const quiet = layoutTopology(topologyOf(bundle, "cert-manager"));
    expect(quiet.nodes.length).toBeGreaterThan(0);
    expect(quiet.nodes.every((n) => n.x >= 0 && n.y >= 0)).toBe(true);
  });
});

describe("tracePath", () => {
  const ui = () => staging.nodes.find((n) => n.id.endsWith("/Deployment/do-dms-staging-dms-ui"))!;

  it("lights the whole way from the Internet to a pod, and what that pod's workload uses", () => {
    const pod = ui().pods![0];
    const trace = tracePath(staging.nodes, staging.edges, pod.id);
    for (const id of ["internet", ids(staging, "loadbalancer")[0], ids(staging, "controller")[0], "ing:do-dms-staging/do-dms-staging-dms-ui-ingress", "svc:do-dms-staging/do-dms-staging-dms-ui", ui().id, pod.id, "svc:do-dms-staging/do-dms-staging-dms-api"]) {
      expect(trace.ids.has(id), id).toBe(true);
    }
    // The other application's own entry is not part of this pod's story.
    expect(trace.ids.has("ing:do-dms-staging/do-dms-staging-dms-api-ingress")).toBe(false);
  });

  it("traces from a Service back to the Internet and on to its pods", () => {
    const trace = tracePath(staging.nodes, staging.edges, "svc:do-dms-staging/do-dms-staging-dms-api");
    expect(trace.ids.has("internet")).toBe(true);
    expect(trace.ids.has("ing:do-dms-staging/do-dms-staging-dms-api-ingress")).toBe(true);
    // The UI reaches the API through this Service, so it is part of the path too.
    expect(trace.ids.has(ui().id)).toBe(true);
  });

  it("keeps sibling pods dark when one pod is selected, and lights them all for the workload", () => {
    const sys = topologyOf(bundle, "kube-system");
    const dns = sys.nodes.find((n) => n.id.endsWith("/Deployment/coredns"))!;
    expect(dns.pods).toHaveLength(2);
    const [first, second] = dns.pods!;

    const one = tracePath(sys.nodes, sys.edges, first.id);
    expect(one.ids.has(first.id)).toBe(true);
    expect(one.ids.has(dns.id)).toBe(true);
    expect(one.ids.has("svc:kube-system/kube-dns")).toBe(true);
    expect(one.ids.has(second.id)).toBe(false);

    const all = tracePath(sys.nodes, sys.edges, dns.id);
    expect(all.ids.has(first.id) && all.ids.has(second.id)).toBe(true);
  });
});
