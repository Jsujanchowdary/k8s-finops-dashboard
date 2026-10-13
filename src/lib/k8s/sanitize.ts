// Noise removal only. Managed fields and the last-applied-configuration annotation (a huge copy of the
// whole manifest) are dropped so the pod is readable; values are shown as Kubernetes returns them.

const DROP_ANNOTATIONS = new Set(["kubectl.kubernetes.io/last-applied-configuration"]);

export function sanitizeAnnotations(annotations: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(annotations ?? {})) {
    if (!DROP_ANNOTATIONS.has(key)) out[key] = value;
  }
  return out;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function toPlain(value: unknown): Json {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = toPlain(v);
    }
    return out;
  }
  if (typeof value === "function") return null;
  return value as Json;
}

/** Returns a plain-JSON copy of the pod without managed fields and the last-applied annotation. */
export function sanitizePod(pod: unknown): unknown {
  const plain = toPlain(pod) as { metadata?: { managedFields?: unknown; annotations?: Record<string, string> } };
  if (plain.metadata) {
    delete plain.metadata.managedFields;
    if (plain.metadata.annotations) plain.metadata.annotations = sanitizeAnnotations(plain.metadata.annotations);
  }
  return plain;
}
