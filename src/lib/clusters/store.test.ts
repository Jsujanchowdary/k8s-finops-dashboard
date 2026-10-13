import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkConnection } from "@/lib/k8s/check";
import { kubeConfigFromInput } from "@/lib/k8s/kubeconfig";
import { addStoredCluster, removeStoredCluster, storedClusters, summarize } from "./store";

const CA = Buffer.from("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n").toString("base64");
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.signature-signature";

describe("saved clusters", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "dashboard-clusters-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    delete (globalThis as { __dashboardClusters?: unknown }).__dashboardClusters;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves to .dashboard/clusters.json readable by this user only, and summaries carry no credentials", async () => {
    // A fresh module state per test: the store keeps its list on globalThis.
    (globalThis as { __dashboardClusters?: unknown }).__dashboardClusters = undefined;
    const saved = await addStoredCluster({ name: "prod-eks", server: "https://x.eks.amazonaws.com", caData: CA, token: TOKEN }, "aws");
    expect(saved.id).toMatch(/^saved:[0-9a-f]{12}$/);
    const file = path.join(dir, ".dashboard", "clusters.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1, clusters: [{ name: "prod-eks", token: TOKEN, provider: "aws" }] });

    const summary = summarize(saved);
    expect(summary).toEqual({ id: saved.id, name: "prod-eks", server: "https://x.eks.amazonaws.com", kind: "saved", provider: "aws", auth: "token", addedAt: saved.addedAt });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(JSON.stringify(summary)).not.toContain(CA);
  });

  it("refuses a second cluster with the same name, and removes by id", async () => {
    (globalThis as { __dashboardClusters?: unknown }).__dashboardClusters = undefined;
    const a = await addStoredCluster({ name: "prod", server: "https://a.example.com", caData: CA, token: TOKEN }, "kubernetes");
    await expect(addStoredCluster({ name: "PROD", server: "https://b.example.com", caData: CA, token: TOKEN }, "kubernetes")).rejects.toThrow(/already saved/);
    expect(await removeStoredCluster("saved:nope")).toBe(false);
    expect(await removeStoredCluster(a.id)).toBe(true);
    expect(await storedClusters()).toEqual([]);
  });

  it("reports a broken file instead of overwriting it", async () => {
    (globalThis as { __dashboardClusters?: unknown }).__dashboardClusters = undefined;
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.join(dir, ".dashboard"));
    writeFileSync(path.join(dir, ".dashboard", "clusters.json"), "{ not json");
    await expect(storedClusters()).rejects.toThrow(/could not be read/);
    await expect(addStoredCluster({ name: "x1", server: "https://a.example.com", caData: CA, token: TOKEN }, "kubernetes")).rejects.toThrow(/could not be read/);
    expect(readFileSync(path.join(dir, ".dashboard", "clusters.json"), "utf8")).toBe("{ not json");
  });
});

describe("checkConnection", () => {
  // A stand-in API server on this machine: answers /version, and the list calls according to `allow`.
  let server: Server;
  let url = "";
  const seen: { path: string; method: string; auth?: string }[] = [];
  let allow = { namespaces: true, nodes: true, pods: true };

  // A throwaway self-signed certificate for 127.0.0.1, so the check runs over verified TLS like a real cluster.
  let caData = "";
  const start = () =>
    new Promise<void>((resolve) => {
      const tls = mkdtempSync(path.join(tmpdir(), "dashboard-tls-"));
      execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", path.join(tls, "key.pem"), "-out", path.join(tls, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
      const cert = readFileSync(path.join(tls, "cert.pem"));
      const key = readFileSync(path.join(tls, "key.pem"));
      rmSync(tls, { recursive: true, force: true });
      caData = cert.toString("base64");
      server = createServer({ cert, key }, (req, res) => {
        seen.push({ path: req.url ?? "", method: req.method ?? "", auth: req.headers.authorization });
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        const forbidden = () => send(403, { kind: "Status", code: 403, message: "forbidden" });
        const p = req.url ?? "";
        if (p.startsWith("/version")) return send(200, { gitVersion: "v1.33.1-eks-1", platform: "linux/amd64" });
        if (p.startsWith("/api/v1/namespaces")) return allow.namespaces ? send(200, { items: [{ metadata: { name: "default" } }] }) : forbidden();
        if (p.startsWith("/api/v1/nodes")) return allow.nodes ? send(200, { items: [{ metadata: { name: "n" }, spec: { providerID: "aws:///us-east-1a/i-0abc" } }] }) : forbidden();
        if (p.startsWith("/api/v1/pods")) return allow.pods ? send(200, { items: [] }) : forbidden();
        send(404, {});
      });
      server.listen(0, "127.0.0.1", () => {
        url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  afterAll(() => server?.close());

  it("tries the version and one item of each list, read-only, with the token, and detects the cloud from the nodes", async () => {
    await start();
    allow = { namespaces: true, nodes: true, pods: true };
    const check = await checkConnection(kubeConfigFromInput({ name: "probe", server: url, caData, token: TOKEN }), url);
    expect(check).toEqual({ ok: true, version: "v1.33.1-eks-1", provider: "aws", reads: { namespaces: "ok", nodes: "ok", pods: "ok" } });
    expect(seen.every((r) => r.method === "GET" && r.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(seen.filter((r) => !r.path.startsWith("/version")).every((r) => /[?&]limit=1\b/.test(r.path))).toBe(true);
  });

  it("names the reads the credentials are not allowed", async () => {
    allow = { namespaces: true, nodes: false, pods: false };
    const check = await checkConnection(kubeConfigFromInput({ name: "probe", server: url, caData, token: TOKEN }), url);
    expect(check).toMatchObject({ ok: false, reads: { namespaces: "ok", nodes: "forbidden", pods: "forbidden" }, message: expect.stringMatching(/may not list nodes, pods.*read-only-rbac/) });
  });

  it("refuses a server whose certificate the given CA did not sign", async () => {
    const other = Buffer.from(execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "/dev/null", "-days", "1", "-subj", "/CN=other"], { stdio: ["ignore", "pipe", "ignore"] })).toString("base64");
    const before = seen.length;
    const check = await checkConnection(kubeConfigFromInput({ name: "probe", server: url, caData: other, token: TOKEN }), url);
    expect(check).toMatchObject({ ok: false, message: expect.stringMatching(/not signed by the CA/) });
    // The token was never sent to a server that could not prove who it is.
    expect(seen.length).toBe(before);
  });

  it("says when the server cannot be reached", async () => {
    // A port that was free a moment ago, so nothing listens there.
    const closed = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const gone = `https://127.0.0.1:${closed}`;
    const check = await checkConnection(kubeConfigFromInput({ name: "probe", server: gone, caData, token: TOKEN }), gone);
    expect(check).toMatchObject({ ok: false, message: expect.stringMatching(/refused the connection/), reads: { namespaces: "skipped" } });
  });
});
