import http from "node:http";
import type { AddressInfo } from "node:net";
import { KubeConfig } from "@kubernetes/client-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadHelmRevisions } from "./helm";

// A fake Kubernetes API on localhost. No real cluster is involved.
let server: http.Server;
let kc: KubeConfig;
const seen: { method?: string; url?: string; accept?: string; auth?: string }[] = [];
let mode: "ok" | "ignores-accept" | "403" | "406" | "slow" = "ok";

const partial = {
  apiVersion: "meta.k8s.io/v1",
  kind: "PartialObjectMetadataList",
  items: [
    { kind: "PartialObjectMetadata", metadata: { name: "sh.helm.release.v1.api.v2", namespace: "ns", labels: { owner: "helm", name: "api", version: "2", status: "deployed", modifiedAt: "1791190000" } } },
    { kind: "PartialObjectMetadata", metadata: { name: "sh.helm.release.v1.api.v1", namespace: "ns", labels: { owner: "helm", name: "api", version: "1", status: "superseded", modifiedAt: "1791100000" } } },
  ],
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, accept: String(req.headers.accept), auth: req.headers.authorization });
    if (mode === "slow") return;
    if (mode === "403" || mode === "406") {
      res.writeHead(Number(mode), { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "Status", message: "no" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (mode === "ignores-accept") {
      res.end(JSON.stringify({ kind: "SecretList", items: [{ metadata: { name: "sh.helm.release.v1.api.v2", labels: { owner: "helm" } }, data: { release: "TOP-SECRET-PAYLOAD" } }] }));
      return;
    }
    res.end(JSON.stringify(partial));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  kc = new KubeConfig();
  kc.loadFromOptions({
    clusters: [{ name: "fake", server: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, skipTLSVerify: true }],
    users: [{ name: "u", token: "test-token" }],
    contexts: [{ name: "ctx", cluster: "fake", user: "u" }],
    currentContext: "ctx",
  });
});

afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));

describe("loadHelmRevisions", () => {
  it("sends one authenticated read-only GET that asks for metadata only", async () => {
    seen.length = 0;
    mode = "ok";
    const result = await loadHelmRevisions(kc);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].auth).toBe("Bearer test-token");
    expect(seen[0].accept).toBe("application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1");
    const url = new URL(seen[0].url!, "http://x");
    expect(url.pathname).toBe("/api/v1/secrets");
    expect(url.searchParams.get("labelSelector")).toBe("owner=helm");
    expect(result).toMatchObject({ state: "ok", revisions: [{ release: "api", revision: 2, status: "deployed" }, { release: "api", revision: 1, status: "superseded" }] });
  });

  it("refuses to use a response that contains Secret contents", async () => {
    mode = "ignores-accept";
    const result = await loadHelmRevisions(kc);
    expect(result.state).toBe("error");
    expect(JSON.stringify(result)).not.toContain("TOP-SECRET-PAYLOAD");
  });

  it("explains a missing permission and an old server", async () => {
    mode = "403";
    expect(await loadHelmRevisions(kc)).toMatchObject({ state: "error", message: expect.stringMatching(/Not allowed to list Secrets/) });
    mode = "406";
    expect(await loadHelmRevisions(kc)).toMatchObject({ state: "error", message: expect.stringMatching(/metadata only/) });
  });

  it("gives up on a hanging cluster instead of blocking the page", async () => {
    mode = "slow";
    const result = await loadHelmRevisions(kc, 150);
    expect(result).toMatchObject({ state: "error", message: expect.stringMatching(/Could not read/) });
  });
});
