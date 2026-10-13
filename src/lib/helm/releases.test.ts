import { describe, expect, it } from "vitest";
import type { PodRow, WorkloadView } from "@/lib/k8s/types";
import type { HelmRevisionRaw } from "./parse";
import { buildHelmReleases } from "./releases";

const workload = (name: string, ns: string, helmRelease: string | undefined, over: Partial<WorkloadView> = {}): WorkloadView => ({
  kind: "Deployment", name, namespace: ns, ready: "1/1", health: "healthy", images: [`ghcr.io/x/${name}:v1`], createdAt: "2026-10-01T00:00:00Z", helmRelease, ...over,
});
const pod = (name: string, ns: string, owner: string, over: Partial<PodRow> = {}): PodRow => ({
  name, namespace: ns, status: "Running", phase: "Running", health: "healthy", ready: "1/1", restarts: 0, createdAt: "2026-10-01T00:00:00Z",
  owner: { kind: "Deployment", name: owner, controller: true }, images: [], cpu: { request: 0, limit: 0, usage: null }, memory: { request: 0, limit: 0, usage: null }, commit: "78669a5", ...over,
});
const rev = (release: string, ns: string, revision: number, status: string): HelmRevisionRaw => ({ release, namespace: ns, revision, status, updatedAt: `2026-10-0${revision}T00:00:00.000Z` });

describe("buildHelmReleases", () => {
  it("joins revisions, workloads and pods into one release", () => {
    const [r] = buildHelmReleases(
      [rev("api", "ns", 1, "superseded"), rev("api", "ns", 3, "deployed"), rev("api", "ns", 2, "superseded")],
      [workload("api", "ns", "api")],
      [pod("api-abc-1", "ns", "api"), pod("api-abc-2", "ns", "api")],
    );
    expect(r).toMatchObject({ name: "api", namespace: "ns", revision: 3, status: "deployed", health: "healthy", commits: ["78669a5"], images: ["ghcr.io/x/api:v1"] });
    expect(r.revisions.map((x) => x.revision)).toEqual([3, 2, 1]);
    expect(r.pods).toEqual({ total: 2, ready: 2, unhealthy: 0 });
  });

  it("still lists releases from workloads alone when the Helm Secrets are unavailable", () => {
    const [r] = buildHelmReleases(null, [workload("ui", "ns", "ui")], [pod("ui-1", "ns", "ui")]);
    expect(r).toMatchObject({ name: "ui", health: "healthy" });
    expect(r.revision).toBeUndefined();
    expect(r.status).toBeUndefined();
    expect(r.revisions).toEqual([]);
  });

  it("ignores workloads that Helm did not create", () => {
    expect(buildHelmReleases(null, [workload("manual", "ns", undefined)], [])).toEqual([]);
  });

  it("keeps the same release name in different namespaces apart", () => {
    const list = buildHelmReleases(null, [workload("redis", "a", "redis"), workload("redis", "b", "redis")], [pod("redis-1", "a", "redis", { commit: "aaa1111" })]);
    expect(list.map((r) => `${r.namespace}/${r.name}`)).toEqual(["a/redis", "b/redis"]);
    expect(list[0].pods.total).toBe(1);
    expect(list[1].pods.total).toBe(0);
  });

  it("turns a failed or pending Helm status and unhealthy pods into the release health", () => {
    const failed = buildHelmReleases([rev("a", "ns", 2, "failed")], [workload("a", "ns", "a")], [pod("a-1", "ns", "a")])[0];
    expect(failed.health).toBe("critical");
    const pending = buildHelmReleases([rev("b", "ns", 2, "pending-upgrade")], [workload("b", "ns", "b")], [])[0];
    expect(pending.health).toBe("warning");
    const crashing = buildHelmReleases(null, [workload("c", "ns", "c", { ready: "0/1", health: "critical" })], [pod("c-1", "ns", "c", { status: "CrashLoopBackOff", health: "critical", ready: "0/1" })])[0];
    expect(crashing.health).toBe("critical");
    expect(crashing.pods.unhealthy).toBe(1);
    expect(crashing.pods.ready).toBe(0);
  });

  it("hides uninstalled releases like `helm list` does, but keeps ones that still have workloads", () => {
    expect(buildHelmReleases([rev("gone", "ns", 4, "uninstalled")], [], [])).toEqual([]);
    expect(buildHelmReleases([rev("odd", "ns", 4, "uninstalled")], [workload("odd", "ns", "odd")], [])).toHaveLength(1);
  });

  it("shows a release that only has revisions (for example a failed first install)", () => {
    const [r] = buildHelmReleases([rev("new", "ns", 1, "failed")], [], []);
    expect(r).toMatchObject({ name: "new", status: "failed", health: "critical", workloads: [] });
  });
});
