import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BALANCE, CLUSTER, CLUSTER_ID, INSIGHTS_CURRENT, INVOICES, NOW, PREVIEW_ITEMS, SIZES, TEAM_URN } from "@/test/finops-sample";
import { checkDigitalOceanToken, createClient, fetchFinops } from "./billing";

// A fake DigitalOcean API on localhost. The real API is never contacted.
let server: http.Server;
let baseUrl = "";
const seen: { method?: string; path: string; auth?: string }[] = [];
let deny = new Set<string>();

const insightsPage = (page: number) => ({
  current_page: String(page),
  total_pages: "2",
  total_items: "3",
  data_points: page === 1 ? INSIGHTS_CURRENT.data_points.slice(0, 2) : INSIGHTS_CURRENT.data_points.slice(2, 3),
});

function answer(path: string): unknown {
  const url = new URL(path, "http://x");
  const page = Number(url.searchParams.get("page") ?? "1");
  const p = url.pathname;
  if (p === `/v2/kubernetes/clusters/${CLUSTER_ID}`) return CLUSTER;
  if (p === "/v2/customers/my/balance") return BALANCE;
  if (p === "/v2/customers/my/invoices") return INVOICES;
  if (p === "/v2/customers/my/invoices/preview") {
    // Two pages, to prove every line is collected.
    const all = PREVIEW_ITEMS.invoice_items;
    const per = Number(url.searchParams.get("per_page"));
    expect(per).toBe(200);
    return { invoice_items: page === 1 ? all.slice(0, 200) : [], meta: { total: all.length } };
  }
  if (p === `/v2/billing/${encodeURIComponent(TEAM_URN)}/insights/2026-10-01/2026-10-13`) return insightsPage(page);
  if (p === `/v2/billing/${encodeURIComponent(TEAM_URN)}/insights/2026-09-01/2026-09-30`) return { total_pages: "1", data_points: [{ start_date: "2026-09-30", total_amount: "4.00", description: "x", sku: "s" }] };
  if (p === "/v2/sizes") return SIZES;
  return undefined;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "";
    seen.push({ method: req.method, path, auth: req.headers.authorization });
    const pathname = new URL(path, "http://x").pathname;
    if (req.headers.authorization === "Bearer revoked-token") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "unauthorized", message: "Unable to authenticate you" }));
      return;
    }
    if ([...deny].some((d) => pathname.startsWith(d))) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "forbidden", message: "nope" }));
      return;
    }
    let body: unknown;
    try {
      body = answer(path);
    } catch {
      body = undefined;
    }
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? { id: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

describe("fetchFinops", () => {
  it("only sends authenticated GETs, and reads everything the page needs", async () => {
    seen.length = 0;
    deny = new Set();
    const data = await fetchFinops(createClient({ baseUrl, token: "test-token" }), CLUSTER_ID, NOW);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.method === "GET" && r.auth === "Bearer test-token")).toBe(true);

    expect(data.clusterName).toEqual({ ok: true, value: "wldd" });
    expect(data.balance).toMatchObject({ ok: true, value: { monthToDateUsage: 111.51 } });
    expect(data.invoices).toMatchObject({ ok: true, value: { preview: { period: "2026-10" } } });
    expect(data.items.ok && data.items.value).toHaveLength(13);
    expect(data.sizes.ok && data.sizes.value).toHaveLength(2);
  });

  it("never calls the Droplet, Volume or Load Balancer APIs (server-001 is off limits)", async () => {
    seen.length = 0;
    deny = new Set();
    await fetchFinops(createClient({ baseUrl, token: "t" }), CLUSTER_ID, NOW);
    const paths = seen.map((r) => new URL(r.path, "http://x").pathname);
    expect(paths.filter((p) => /\/v2\/(droplets|volumes|load_balancers|snapshots|actions)/.test(p))).toEqual([]);
    expect(new Set(paths.map((p) => p.split("/").slice(0, 3).join("/")))).toEqual(new Set(["/v2/kubernetes", "/v2/customers", "/v2/sizes", "/v2/billing"]));
  });

  it("follows Billing Insights pages and reads this month to today and the whole of last month", async () => {
    seen.length = 0;
    deny = new Set();
    const data = await fetchFinops(createClient({ baseUrl, token: "t" }), CLUSTER_ID, NOW);
    if (!data.insights.ok) throw new Error(data.insights.message);
    expect(data.insights.value.current).toHaveLength(3);
    expect(data.insights.value.previous).toEqual([{ date: "2026-09-30", amount: 4, description: "x", sku: "s", groupDescription: undefined }]);
    const insightCalls = seen.filter((r) => r.path.includes("/insights/2026-10-01/2026-10-13"));
    expect(insightCalls.map((r) => new URL(r.path, "http://x").searchParams.get("page"))).toEqual(["1", "2"]);
  });

  it("a missing scope fails only its own part, with a message that names the scope", async () => {
    deny = new Set(["/v2/sizes", "/v2/billing/"]);
    const data = await fetchFinops(createClient({ baseUrl, token: "t" }), CLUSTER_ID, NOW);
    expect(data.sizes).toEqual({ ok: false, message: "The token is not allowed to read this. Add the sizes:read scope to it." });
    expect(data.insights).toMatchObject({ ok: false, message: expect.stringContaining("billing:read") });
    expect(data.balance.ok).toBe(true);
    expect(data.items.ok).toBe(true);
    deny = new Set();
  });

  it("never puts the token in an error message", async () => {
    deny = new Set(["/v2/"]);
    const data = await fetchFinops(createClient({ baseUrl, token: "super-secret-token" }), CLUSTER_ID, NOW);
    expect(JSON.stringify(data)).not.toContain("super-secret-token");
    expect(data.balance.ok).toBe(false);
    deny = new Set();
  });

  it("gives up on a DigitalOcean that does not answer", async () => {
    const hanging = http.createServer(() => {});
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`;
    const data = await fetchFinops(createClient({ baseUrl: url, token: "t", timeoutMs: 150 }), CLUSTER_ID, NOW);
    expect(data.balance).toMatchObject({ ok: false, message: expect.stringContaining("Could not reach") });
    await new Promise<void>((resolve) => { hanging.closeAllConnections?.(); hanging.close(() => resolve()); });
  });
});

describe("checkDigitalOceanToken", () => {
  const server = `https://${CLUSTER_ID}.k8s.ondigitalocean.com`;

  it("tries one read-only request per scope and names the cluster", async () => {
    seen.length = 0;
    deny = new Set();
    const check = await checkDigitalOceanToken("good-token", server, { baseUrl });
    expect(check).toEqual({ valid: true, message: undefined, scopes: { kubernetes: "ok", billing: "ok", sizes: "ok" }, clusterName: "wldd" });
    expect(seen.every((r) => r.method === "GET")).toBe(true);
    expect(seen.map((r) => new URL(r.path, "http://x").pathname).sort()).toEqual(["/v2/customers/my/balance", `/v2/kubernetes/clusters/${CLUSTER_ID}`, "/v2/sizes"]);
  });

  it("says which scope is missing", async () => {
    deny = new Set(["/v2/customers/"]);
    const check = await checkDigitalOceanToken("good-token", server, { baseUrl });
    expect(check).toMatchObject({ valid: true, scopes: { kubernetes: "ok", billing: "missing", sizes: "ok" } });
    deny = new Set();
  });

  it("rejects a token DigitalOcean refuses", async () => {
    const check = await checkDigitalOceanToken("revoked-token", server, { baseUrl });
    expect(check).toMatchObject({ valid: false, message: expect.stringContaining("rejected this token") });
    expect(JSON.stringify(check)).not.toContain("revoked-token");
  });

  it("explains when the cluster is not on DigitalOcean", async () => {
    const check = await checkDigitalOceanToken("good-token", "https://kubernetes.example.com", { baseUrl });
    expect(check.scopes.kubernetes).toBe("error");
    expect(check.scopes.billing).toBe("ok");
  });
});
