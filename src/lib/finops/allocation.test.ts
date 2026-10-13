import { describe, expect, it } from "vitest";
import type { NodeView, PodRow, PvcView } from "@/lib/k8s/types";
import { INSIGHTS_CURRENT, NOW, PREVIEW_ITEMS, SIZES } from "@/test/finops-sample";
import { allocate, CPU_SHARE, loadBalancerName, monthly, otherDroplets, podsWithoutRequests, poolCeilings, priceNodes, snapshotsAndBackups } from "./allocation";
import { parseInsights, parseInvoiceItems, parseSizes } from "./parse";
import { costLines } from "./spend";

const GIB = 1024 ** 3;
const sizes = parseSizes(SIZES);
const { lines } = costLines(parseInvoiceItems(PREVIEW_ITEMS).items, { period: "2026-10", now: NOW, insights: parseInsights(INSIGHTS_CURRENT).points });
const clusterLines = lines.filter((l) => l.groupDescription === "wldd");

const node = (name: string, instanceType?: string) => ({ name, instanceType }) as NodeView;
const pod = (namespace: string, name: string, o: { node?: string; cpu?: [number, number | null]; mem?: [number, number | null]; phase?: string } = {}) =>
  ({
    namespace,
    name,
    nodeName: o.node === undefined ? "n1" : o.node || undefined,
    phase: o.phase ?? "Running",
    cpu: { request: o.cpu?.[0] ?? 0, limit: 0, usage: o.cpu ? o.cpu[1] : 0 },
    memory: { request: o.mem?.[0] ?? 0, limit: 0, usage: o.mem ? o.mem[1] : 0 },
  }) as PodRow;
const pvc = (namespace: string, name: string, volumeName?: string) => ({ namespace, name, volumeName }) as PvcView;
// The real ingress Service: DigitalOcean named its load balancer "a" + this UID without dashes.
const INGRESS = { namespace: "ingress-nginx", name: "ingress-nginx-controller", uid: "c4cbf573-411d-41a5-9dd9-15f5fc2f933b" };

const PRICE = 0.14286;
const CPU_RATE = (PRICE * CPU_SHARE) / 8;
const MEM_RATE = (PRICE * (1 - CPU_SHARE)) / 16;

describe("node prices", () => {
  it("splits the node price half to CPU, half to memory", () => {
    const [p] = priceNodes([node("n1", "s-8vcpu-16gb")], sizes);
    expect(p).toEqual({ name: "n1", size: "s-8vcpu-16gb", hourly: PRICE, cpuRate: CPU_RATE, memRate: MEM_RATE });
    expect(p.cpuRate * 8 + p.memRate * 16).toBeCloseTo(PRICE, 12);
  });

  it("leaves a node whose size has no price unpriced instead of guessing", () => {
    expect(priceNodes([node("n2", "g-weird")], sizes)[0]).toMatchObject({ hourly: null, cpuRate: 0, memRate: 0 });
  });
});

describe("allocation", () => {
  const result = allocate({
    nodes: [node("n1", "s-8vcpu-16gb")],
    rows: [
      // Requests 1 core / 2 GiB, uses less: charged the request; the gap is "requested but unused".
      pod("api", "api-1", { cpu: [1, 0.25], mem: [2 * GIB, 1 * GIB] }),
      // Uses more than it requests: charged what it uses.
      pod("api", "api-2", { cpu: [0.5, 1.5], mem: [1 * GIB, 3 * GIB] }),
      // No requests at all: charged its usage.
      pod("tools", "tool-1", { cpu: [0, 0.1], mem: [0, 0.5 * GIB] }),
      // Finished and unscheduled pods cost nothing.
      pod("api", "job-1", { cpu: [4, null], phase: "Succeeded" }),
      pod("api", "pending-1", { node: "", cpu: [2, null] }),
    ],
    pvcs: [pvc("api", "data", "pvc-e5a8e9e2-16fc-4437-8716-bb65b313619b"), pvc("tools", "cache", "pvc-ac1ad37a-ab36-4f9d-bc2d-0c7579e71c9a"), pvc("tools", "new", "pvc-99999999-16fc-4437-8716-bb65b313619b")],
    loadBalancerServices: [INGRESS],
    sizes,
    clusterLines,
    metricsAvailable: true,
  });
  const api = result.namespaces.find((n) => n.namespace === "api")!;
  const tools = result.namespaces.find((n) => n.namespace === "tools")!;

  it("charges each pod max(request, usage)", () => {
    expect(api.pods).toBe(2);
    expect(api.cpu).toBeCloseTo((1 + 1.5) * CPU_RATE, 12);
    expect(api.memory).toBeCloseTo((2 + 3) * MEM_RATE, 12);
    expect(tools.cpu).toBeCloseTo(0.1 * CPU_RATE, 12);
    expect(tools.memory).toBeCloseTo(0.5 * MEM_RATE, 12);
  });

  it("details each pod's cost and what it was charged on", () => {
    expect(api.podCosts.map((p) => [p.pod, p.cpuBasis, p.memBasis])).toEqual([
      ["api-2", "usage", "usage"],
      ["api-1", "request", "request"],
    ]);
    const p2 = api.podCosts[0];
    expect(p2).toMatchObject({ node: "n1", cpuCores: 1.5, memGib: 3, cpuRate: CPU_RATE, memRate: MEM_RATE });
    expect(p2.total).toBeCloseTo(1.5 * CPU_RATE + 3 * MEM_RATE, 12);
    expect(api.podCosts.reduce((a, p) => a + p.total, 0)).toBeCloseTo(api.cpu + api.memory, 12);
  });

  it("details each claim's volume rate, zero when it has no invoice line yet", () => {
    expect(tools.volumeCosts).toEqual([
      { claim: "cache", volume: "pvc-ac1ad37a-ab36-4f9d-bc2d-0c7579e71c9a", hourly: 0.04 / 288 },
      { claim: "new", volume: "pvc-99999999-16fc-4437-8716-bb65b313619b", hourly: 0 },
    ]);
  });

  it("counts requested-but-unused capacity", () => {
    expect(api.unusedCpu).toBeCloseTo(0.75 * CPU_RATE, 12);
    expect(api.unusedMemory).toBeCloseTo(1 * MEM_RATE, 12);
    expect(tools.unusedCpu).toBe(0);
  });

  it("adds each claim's volume from its invoice line", () => {
    expect(api.storage).toBeCloseTo(0.43 / 288, 12);
    expect(tools.storage).toBeCloseTo(0.04 / 288, 12);
    expect(result.unpricedClaims).toEqual(["tools/new"]);
    // The 8 GB volume on the invoice has no claim in this cluster.
    expect(result.unclaimedVolumes).toEqual([{ name: "pvc-fef5ad56-1793-40c9-be22-82f180a6e396", hourly: 0.34 / 288 }]);
  });

  it("names load balancers the way DigitalOcean does", () => {
    expect(loadBalancerName(INGRESS)).toBe("ac4cbf573411d41a59dd915f5fc2f933");
    expect(loadBalancerName({ ...INGRESS, nameAnnotation: "my-lb" })).toBe("my-lb");
  });

  it("treats the load balancer as shared and finds the Service that owns it", () => {
    expect(result.shared).toEqual([{ name: "ac4cbf573411d41a59dd915f5fc2f933", owner: "ingress-nginx/ingress-nginx-controller", hourly: 6.43 / 288 }]);
  });

  it("idle is the node price minus every pod's cost, and everything adds up to the total", () => {
    const podCost = api.cpu + api.memory + tools.cpu + tools.memory;
    expect(result.idle.total).toBeCloseTo(PRICE - podCost, 12);
    const rows = result.namespaces.reduce((a, n) => a + n.total, 0) + result.idle.total + result.shared.reduce((a, s) => a + s.hourly, 0) + result.unclaimedVolumes.reduce((a, v) => a + v.hourly, 0);
    expect(rows).toBeCloseTo(result.total, 12);
    expect(result.overcommitted).toEqual([]);
  });

  it("agrees with what the invoice says the cluster costs per hour", () => {
    // List price $0.14286 vs invoice $0.14321 for the node; volumes and LB come from the invoice itself.
    expect(Math.abs(result.total - result.invoiceRate)).toBeLessThan(0.001);
  });

  it("counts pods that cost nothing", () => {
    expect(result.unscheduledPods).toBe(1);
    expect(result.unpricedPods).toBe(0);
  });

  it("without metrics, charges requests and leaves the unused figures empty", () => {
    const noMetrics = allocate({ nodes: [node("n1", "s-8vcpu-16gb")], rows: [pod("api", "a", { cpu: [1, null], mem: [GIB, null] })], pvcs: [], loadBalancerServices: [], sizes, clusterLines: [], metricsAvailable: false });
    expect(noMetrics.namespaces[0]).toMatchObject({ cpu: CPU_RATE, unusedCpu: null, unusedMemory: null });
    expect(noMetrics.namespaces[0].memory).toBeCloseTo(MEM_RATE, 12);
  });

  it("flags a node whose pods use more than it has", () => {
    const over = allocate({ nodes: [node("n1", "s-8vcpu-16gb")], rows: [pod("a", "big", { cpu: [9, 9] })], pvcs: [], loadBalancerServices: [], sizes, clusterLines: [], metricsAvailable: true });
    expect(over.overcommitted).toEqual(["n1"]);
    expect(over.idle.cpu).toBe(0);
  });
});

describe("efficiency checks", () => {
  it("monthly means 672 hours, the most DigitalOcean bills in a month", () => {
    expect(monthly(PRICE)).toBeCloseTo(96, 1);
  });

  it("lists running pods without CPU or memory requests", () => {
    const rows = [pod("b", "x", { cpu: [0, 0], mem: [GIB, 0] }), pod("a", "y", { cpu: [1, 0], mem: [0, 0] }), pod("a", "ok", { cpu: [1, 0], mem: [GIB, 0] }), pod("a", "done", { phase: "Succeeded" })];
    expect(podsWithoutRequests(rows)).toEqual([
      { namespace: "a", pod: "y", cpu: false, memory: true },
      { namespace: "b", pod: "x", cpu: true, memory: false },
    ]);
  });

  it("prices the autoscaler's ceiling", () => {
    expect(poolCeilings([{ name: "wldd-16gb", size: "s-8vcpu-16gb", count: 1, autoScale: true, maxNodes: 2 }], sizes)).toEqual([{ name: "wldd-16gb", size: "s-8vcpu-16gb", count: 1, maxNodes: 2, nowMonthly: 96, maxMonthly: 192 }]);
    expect(poolCeilings([{ name: "fixed", size: "unknown", count: 3, autoScale: false }], sizes)[0]).toMatchObject({ maxNodes: 3, nowMonthly: null, maxMonthly: null });
  });

  it("lists Droplets billed outside the cluster, from the invoice, with their backups", () => {
    const [d, ...rest] = otherDroplets(lines, sizes);
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ name: "server-001", detail: "s-8vcpu-16gb", monthly: 96, amount: 41.14, running: true });
    expect(d.backups).toBeCloseTo((1.03 / 24) * 672, 6);
  });

  it("lists snapshots and backups, biggest first", () => {
    expect(snapshotsAndBackups(lines).map((l) => l.product)).toEqual(["Droplet Backups", "Volume Snapshots"]);
  });
});
