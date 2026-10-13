// Helm keeps one Secret per release revision. Only the labels on those Secrets are used here (release name,
// revision, status, deployed time). The packed payload that holds the chart and the deploy values is never
// requested, and this parser refuses a response that contains it.

export interface HelmRevisionRaw {
  release: string;
  namespace: string;
  revision: number;
  /** deployed, superseded, failed, uninstalled, pending-install, pending-upgrade, pending-rollback, ... */
  status: string;
  updatedAt?: string;
}

const SECRET_NAME = /^sh\.helm\.release\.v1\.(.+)\.v(\d+)$/;

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Reads a Kubernetes `PartialObjectMetadataList`. Anything else, in particular a full SecretList that would
 * carry the Secret data, is rejected and not looked at further.
 */
export function parseHelmSecretList(body: unknown): { ok: true; revisions: HelmRevisionRaw[] } | { ok: false; message: string } {
  const list = body as { kind?: unknown; items?: unknown } | null;
  if (list?.kind !== "PartialObjectMetadataList") {
    return { ok: false, message: "Kubernetes did not return metadata only, so the response was ignored (Secret contents are never read)." };
  }
  const items = Array.isArray(list.items) ? list.items : [];
  const revisions: HelmRevisionRaw[] = [];
  for (const item of items) {
    const meta = ((item as { metadata?: Record<string, unknown> }).metadata ?? {}) as Record<string, unknown>;
    const labels = (meta.labels ?? {}) as Record<string, string>;
    if (labels.owner !== "helm") continue;
    const fromName = SECRET_NAME.exec(String(meta.name ?? ""));
    const release = labels.name ?? fromName?.[1];
    const revision = Number(labels.version ?? fromName?.[2]);
    if (!release || !Number.isInteger(revision)) continue;
    // Helm creates a new Secret for every revision, so the Secret's creation time is when that revision was
    // deployed. The labels are only a fallback: `modifiedAt` also moves when an old revision is marked
    // superseded, so it is not the deploy time.
    const stamp = Number(labels.createdAt ?? labels.modifiedAt);
    revisions.push({
      release,
      namespace: String(meta.namespace ?? ""),
      revision,
      status: labels.status ?? "unknown",
      updatedAt: isoOrUndefined(meta.creationTimestamp) ?? (Number.isFinite(stamp) && stamp > 0 ? new Date(stamp * 1000).toISOString() : undefined),
    });
  }
  return { ok: true, revisions };
}
