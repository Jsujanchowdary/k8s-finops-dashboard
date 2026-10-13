import { describe, expect, it } from "vitest";
import { clusterIdFromServer, parseNodePools, statusMessage } from "./node-pools-core";

describe("clusterIdFromServer", () => {
  it("reads the cluster id from a DOKS API server URL", () => {
    expect(clusterIdFromServer("https://2527C9F4-cb99-445f-a085-e48f17aab7cb.k8s.ondigitalocean.com")).toBe("2527c9f4-cb99-445f-a085-e48f17aab7cb");
    expect(clusterIdFromServer("https://2527c9f4-cb99-445f-a085-e48f17aab7cb.k8s.ondigitalocean.com:443/")).toBe("2527c9f4-cb99-445f-a085-e48f17aab7cb");
  });
  it("returns nothing for other clusters", () => {
    expect(clusterIdFromServer("https://127.0.0.1:6443")).toBeUndefined();
    expect(clusterIdFromServer("https://abc.k8s.ondigitalocean.com")).toBeUndefined();
    expect(clusterIdFromServer("https://evil.example/2527c9f4-cb99-445f-a085-e48f17aab7cb.k8s.ondigitalocean.com")).toBeUndefined();
  });
});

describe("parseNodePools", () => {
  it("reads autoscaling pools", () => {
    const pools = parseNodePools({ node_pools: [{ id: "a", name: "wldd-16gb", size: "s-8vcpu-16gb", count: 2, auto_scale: true, min_nodes: 1, max_nodes: 3, nodes: [{ name: "n1" }, { name: "n2" }] }] });
    expect(pools).toEqual([{ id: "a", name: "wldd-16gb", size: "s-8vcpu-16gb", count: 2, autoScale: true, minNodes: 1, maxNodes: 3, nodeNames: ["n1", "n2"] }]);
  });
  it("ignores stale min/max left behind when autoscaling is off", () => {
    const [pool] = parseNodePools({ node_pools: [{ id: "a", name: "wldd", size: "s-4vcpu-8gb", count: 1, min_nodes: 1, max_nodes: 3 }] });
    expect(pool.autoScale).toBe(false);
    expect(pool.minNodes).toBeUndefined();
    expect(pool.maxNodes).toBeUndefined();
  });
  it("falls back to the node list for the count and survives bad input", () => {
    expect(parseNodePools({ node_pools: [{ name: "p", nodes: [{ name: "x" }, { name: "y" }] }] })[0].count).toBe(2);
    expect(parseNodePools(null)).toEqual([]);
    expect(parseNodePools({ node_pools: "nope" })).toEqual([]);
    expect(parseNodePools({})).toEqual([]);
  });
});

describe("statusMessage", () => {
  it("explains the common failures", () => {
    expect(statusMessage(401)).toMatch(/rejected the token/);
    expect(statusMessage(403)).toMatch(/Kubernetes read scope/);
    expect(statusMessage(404)).toMatch(/does not show this cluster/);
    expect(statusMessage(429)).toMatch(/rate limit/);
    expect(statusMessage(500)).toMatch(/500/);
  });
});
