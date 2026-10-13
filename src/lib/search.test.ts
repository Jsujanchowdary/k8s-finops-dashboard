import { describe, expect, it } from "vitest";
import { sampleLoadedCluster } from "@/test/loaded-cluster";
import { buildSearchIndex, search, type SearchEntry } from "./search";

const index = buildSearchIndex(sampleLoadedCluster());
const top = (q: string) => search(index, q)[0];

describe("buildSearchIndex", () => {
  it("indexes every kind of thing the dashboard shows, from the data already loaded", () => {
    const kinds = new Set(index.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(["Certificate", "Helm release", "Ingress", "Namespace", "Node", "Page", "Pod", "Service", "Volume", "Workload"]);
  });

  it("links each result to the page that shows it", () => {
    const pod = index.find((e) => e.kind === "Pod" && e.title.startsWith("cert-manager-"))!;
    expect(pod.href).toBe(`/namespaces/cert-manager/pods/${pod.title}`);
    expect(index.find((e) => e.kind === "Helm release" && e.title === "cert-manager")?.href).toBe("/helm/cert-manager/cert-manager");
    expect(index.find((e) => e.kind === "Service" && e.title === "ingress-nginx-controller")?.href).toBe("/namespaces/ingress-nginx?tab=network");
    expect(index.find((e) => e.kind === "Certificate")?.href).toBe("/certificates");
  });

  it("never indexes environment values", () => {
    const withEnv = sampleLoadedCluster((b) => ({
      ...b,
      pods: b.pods.map((p) => ({ ...p, spec: { ...p.spec!, containers: p.spec!.containers.map((c) => ({ ...c, env: [{ name: "DB_URL", value: "mongodb+srv://admin:p4ssw0rd@cluster0.example.net/dms" }] })) } })),
    }));
    const text = JSON.stringify(buildSearchIndex(withEnv));
    expect(text).not.toContain("p4ssw0rd");
    expect(text).not.toContain("mongodb+srv");
    expect(text).not.toContain("DB_URL");
  });
});

describe("search", () => {
  it("finds a pod by its IP and says it matched on the IP", () => {
    const r = top("10.108.2.11");
    expect(r.entry.kind).toBe("Pod");
    expect(r.entry.title).toMatch(/^cert-manager-/);
    expect(r.matched).toEqual({ label: "IP", value: "10.108.2.11" });
  });

  it("finds the Service behind a public IP", () => {
    expect(top("203.0.113.50")).toMatchObject({ entry: { kind: "Service", title: "ingress-nginx-controller" }, matched: { label: "public IP" } });
  });

  it("finds everything running an image", () => {
    const kinds = search(index, "cert-manager-webhook:v1.21.1").map((r) => r.entry.kind);
    expect(kinds).toContain("Pod");
    expect(kinds).toContain("Workload");
    expect(kinds).toContain("Helm release");
  });

  it("finds an Ingress and its certificate by host", () => {
    const results = search(index, "pandora.wldd.in");
    expect(results.map((r) => r.entry.kind)).toEqual(expect.arrayContaining(["Certificate"]));
    expect(results.every((r) => r.matched?.label === "host")).toBe(true);
  });

  it("ranks an exact name first, then names starting with the query, then the rest", () => {
    const results = search(index, "cert-manager");
    expect(results[0].entry.title).toBe("cert-manager");
    // Exact matches tie on score; kinds then decide (namespace before workload before Helm release).
    expect(results.slice(0, 3).map((r) => r.entry.kind)).toEqual(["Namespace", "Workload", "Helm release"]);
    const firstPartial = results.findIndex((r) => r.entry.title !== "cert-manager");
    expect(results.slice(firstPartial).every((r) => r.entry.title.startsWith("cert-manager") || r.matched)).toBe(true);
  });

  it("needs every word, wherever it matches (name, namespace or a field)", () => {
    const results = search(index, "dms api staging");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const all = [r.entry.title, r.entry.subtitle ?? "", ...r.entry.fields.map((f) => f.value)].join(" ").toLowerCase();
      for (const w of ["dms", "api", "staging"]) expect(all).toContain(w);
    }
  });

  it("finds pages by name and by what they are about", () => {
    expect(top("finops")).toMatchObject({ entry: { kind: "Page", href: "/finops" } });
    expect(top("billing").entry.href).toBe("/finops");
    expect(top("rbac").entry.href).toBe("/access");
  });

  it("is case-insensitive, ignores surrounding spaces, and returns nothing for an empty query", () => {
    expect(top("  FINOPS ").entry.href).toBe("/finops");
    expect(search(index, "")).toEqual([]);
    expect(search(index, "   ")).toEqual([]);
    expect(search(index, "zzz-nothing-like-this")).toEqual([]);
  });

  it("prefers the shorter of two equally good names", () => {
    const tiny: SearchEntry[] = [
      { kind: "Workload", title: "redis-master", href: "/a", fields: [] },
      { kind: "Workload", title: "redis", href: "/b", fields: [] },
      { kind: "Workload", title: "redis-replicas", href: "/c", fields: [] },
    ];
    expect(search(tiny, "redis").map((r) => r.entry.title)).toEqual(["redis", "redis-master", "redis-replicas"]);
    expect(search(tiny, "red").map((r) => r.entry.title)).toEqual(["redis", "redis-master", "redis-replicas"]);
  });

  it("caps the number of results", () => {
    expect(search(index, "a", 5)).toHaveLength(5);
  });
});
