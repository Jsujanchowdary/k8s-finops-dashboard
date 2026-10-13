import { describe, expect, it } from "vitest";
import { parseHelmSecretList } from "./parse";

const item = (name: string, ns: string, labels: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  apiVersion: "meta.k8s.io/v1",
  kind: "PartialObjectMetadata",
  metadata: { name, namespace: ns, labels, creationTimestamp: "2026-10-05T07:24:45Z", ...extra },
});

describe("parseHelmSecretList", () => {
  it("reads release, revision and status from the labels and the deploy time from the Secret's creation time", () => {
    const result = parseHelmSecretList({
      kind: "PartialObjectMetadataList",
      items: [item("sh.helm.release.v1.do-dms-staging-dms-api.v10", "do-dms-staging", { owner: "helm", name: "do-dms-staging-dms-api", status: "deployed", version: "10", modifiedAt: "1700000000" })],
    });
    // creationTimestamp (2026-10-05T07:24:45Z) wins over the older modifiedAt label
    expect(result).toEqual({ ok: true, revisions: [{ release: "do-dms-staging-dms-api", namespace: "do-dms-staging", revision: 10, status: "deployed", updatedAt: "2026-10-05T07:24:45.000Z" }] });
  });

  it("uses a label time only when the creation time is missing", () => {
    const result = parseHelmSecretList({
      kind: "PartialObjectMetadataList",
      items: [{ kind: "PartialObjectMetadata", metadata: { name: "sh.helm.release.v1.a.v1", namespace: "n", labels: { owner: "helm", name: "a", version: "1", status: "deployed", createdAt: "1791190000" } } }],
    });
    expect(result.ok && result.revisions[0].updatedAt).toBe(new Date(1791190000 * 1000).toISOString());
  });

  it("falls back to the Secret name and creation time when labels are missing", () => {
    const result = parseHelmSecretList({ kind: "PartialObjectMetadataList", items: [item("sh.helm.release.v1.redis.v3", "redis", { owner: "helm" })] });
    expect(result).toEqual({ ok: true, revisions: [{ release: "redis", namespace: "redis", revision: 3, status: "unknown", updatedAt: "2026-10-05T07:24:45.000Z" }] });
  });

  it("ignores Secrets that are not Helm releases", () => {
    const result = parseHelmSecretList({ kind: "PartialObjectMetadataList", items: [item("my-secret", "x", { app: "y" }), item("sh.helm.release.v1.a.v1", "x", { owner: "helm", name: "a", version: "1", status: "deployed" })] });
    expect(result.ok && result.revisions.map((r) => r.release)).toEqual(["a"]);
  });

  it("refuses a full SecretList, so Secret contents are never used", () => {
    const full = { kind: "SecretList", items: [{ metadata: { name: "sh.helm.release.v1.a.v1", labels: { owner: "helm" } }, data: { release: "aGVsbG8=" } }] };
    const result = parseHelmSecretList(full);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("aGVsbG8=");
  });

  it("survives garbage", () => {
    for (const bad of [null, undefined, "x", 5, {}, { kind: "PartialObjectMetadataList" }]) {
      const r = parseHelmSecretList(bad);
      if (r.ok) expect(r.revisions).toEqual([]);
    }
  });
});
