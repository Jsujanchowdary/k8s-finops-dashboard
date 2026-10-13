// Matching for global search, used in the browser by the Cmd+K box. Kept apart from the index builder so the
// browser bundle does not include the Kubernetes view code.

export type SearchKind = "Page" | "Namespace" | "Node" | "Workload" | "Pod" | "Service" | "Ingress" | "Volume" | "Helm release" | "Certificate";

/** Shown in this order when results tie. */
export const KIND_ORDER: SearchKind[] = ["Page", "Namespace", "Workload", "Pod", "Service", "Ingress", "Certificate", "Helm release", "Volume", "Node"];

export interface SearchField {
  /** What the value is, shown when a result matched on it: "IP", "host", "image"... */
  label: string;
  value: string;
}

export interface SearchEntry {
  kind: SearchKind;
  title: string;
  /** Namespace, status or other context. */
  subtitle?: string;
  href: string;
  /** Everything else it can be found by. */
  fields: SearchField[];
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface SearchResult {
  entry: SearchEntry;
  score: number;
  /** The field that matched, when it was not the title (shown under the result). */
  matched?: SearchField;
}

/**
 * Every word of the query must appear in the title or one of the fields (case-insensitive).
 * Ranked: exact title, title starting with the query, title containing it, then a field match.
 */
export function search(index: SearchEntry[], query: string, limit = 40): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const results: SearchResult[] = [];

  for (const entry of index) {
    const title = entry.title.toLowerCase();
    const subtitle = (entry.subtitle ?? "").toLowerCase();
    const fields = entry.fields.map((f) => ({ f, v: f.value.toLowerCase() }));
    const everywhere = [title, subtitle, ...fields.map((x) => x.v)];
    if (!words.every((w) => everywhere.some((v) => v.includes(w)))) continue;

    let score: number;
    let matched: SearchField | undefined;
    if (title === q) score = 100;
    else if (title.startsWith(q)) score = 80;
    else if (title.includes(q)) score = 60;
    else {
      const exact = fields.find((x) => x.v === q);
      const partial = fields.find((x) => x.v.includes(q));
      if (exact) {
        score = 70;
        matched = exact.f;
      } else if (partial) {
        score = 40;
        matched = partial.f;
      } else {
        // Words matched in different places ("dms staging" -> title + namespace).
        score = 20;
        matched = fields.find((x) => words.some((w) => x.v.includes(w)) && !title.includes(words[0]))?.f;
      }
    }
    // Among equally good name matches, shorter names first ("redis" before "redis-master"). For a match on a field
    // (an IP, host or image) the kind decides instead, so a Service's own IP ranks above Ingresses that report it.
    results.push({ entry, score: matched ? score : score - Math.min(entry.title.length, 60) / 100, matched });
  }

  return results
    .sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.entry.kind) - KIND_ORDER.indexOf(b.entry.kind) || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit);
}
