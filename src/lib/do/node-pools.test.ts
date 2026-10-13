import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchNodePools, loadNodePools } from "./node-pools";

// A fake DigitalOcean API on localhost. The real API is never contacted.
let server: http.Server;
let baseUrl = "";
const seen: { method?: string; url?: string; auth?: string }[] = [];
let mode: "ok" | "401" | "403" | "404" | "slow" = "ok";

const CLUSTER = "2527c9f4-cb99-445f-a085-e48f17aab7cb";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    if (mode === "slow") return; // never answers
    if (mode !== "ok") {
      res.writeHead(Number(mode), { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "x", message: "nope" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ node_pools: [{ id: "p1", name: "wldd-16gb", size: "s-8vcpu-16gb", count: 1, auto_scale: true, min_nodes: 1, max_nodes: 3, nodes: [{ name: "wldd-16gb-abc" }] }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

describe("fetchNodePools", () => {
  it("sends one authenticated read-only GET for this cluster's node pools", async () => {
    seen.length = 0;
    mode = "ok";
    const result = await fetchNodePools({ baseUrl, token: "test-token", clusterId: CLUSTER });
    expect(seen).toEqual([{ method: "GET", url: `/v2/kubernetes/clusters/${CLUSTER}/node_pools`, auth: "Bearer test-token" }]);
    expect(result).toMatchObject({ state: "ok", pools: [{ name: "wldd-16gb", autoScale: true, minNodes: 1, maxNodes: 3, count: 1 }] });
  });

  it("turns rejections into readable messages", async () => {
    for (const [code, expected] of [["401", /rejected the token/], ["403", /Kubernetes read scope/], ["404", /does not show this cluster/]] as const) {
      mode = code;
      const result = await fetchNodePools({ baseUrl, token: "t", clusterId: CLUSTER });
      expect(result).toMatchObject({ state: "error" });
      expect((result as { message: string }).message).toMatch(expected);
    }
  });

  it("gives up on a hanging API instead of blocking the page", async () => {
    mode = "slow";
    const result = await fetchNodePools({ baseUrl, token: "t", clusterId: CLUSTER, timeoutMs: 150 });
    expect(result).toMatchObject({ state: "error" });
    expect((result as { message: string }).message).toMatch(/Could not reach/);
  });

  it("never puts the token in an error message", async () => {
    mode = "401";
    const result = await fetchNodePools({ baseUrl, token: "super-secret-token", clusterId: CLUSTER });
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
  });
});

describe("loadNodePools", () => {
  it("explains a missing token and a non-DigitalOcean cluster without calling anything", async () => {
    const before = seen.length;
    const saved = process.env.DIGITALOCEAN_TOKEN;
    delete process.env.DIGITALOCEAN_TOKEN;
    expect(await loadNodePools(`https://${CLUSTER}.k8s.ondigitalocean.com`)).toEqual({ state: "no-token" });
    process.env.DIGITALOCEAN_TOKEN = "t";
    expect(await loadNodePools("https://127.0.0.1:6443")).toEqual({ state: "not-doks" });
    if (saved === undefined) delete process.env.DIGITALOCEAN_TOKEN;
    else process.env.DIGITALOCEAN_TOKEN = saved;
    expect(seen.length).toBe(before);
  });
});
