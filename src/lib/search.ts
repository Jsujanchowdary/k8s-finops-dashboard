// Global search: one index of everything the dashboard shows, and the matching behind the Cmd+K box.
// Built on the server from data already loaded for the pages (no extra cluster reads) and searched in the browser.
// It holds names, hosts, IPs, image references, commits and Helm release names; never environment values or Secrets.

import type { LoadedCluster } from "@/lib/data";
import { buildIngressViews, buildPvcViews, buildServiceViews, buildWorkloads } from "@/lib/k8s/views";
import type { SearchEntry, SearchField } from "./search-match";

export { KIND_ORDER, search, type SearchEntry, type SearchField, type SearchKind, type SearchResult } from "./search-match";

const nsHref = (ns: string) => `/namespaces/${encodeURIComponent(ns)}`;
const uniq = (fields: SearchField[]) => {
  const seen = new Set<string>();
  return fields.filter((f) => f.value && !seen.has(`${f.label}|${f.value}`) && seen.add(`${f.label}|${f.value}`));
};

export const PAGES: SearchEntry[] = [
  { kind: "Page", title: "Overview", href: "/", fields: [{ label: "page", value: "home cluster summary nodes namespaces" }] },
  { kind: "Page", title: "Helm releases", href: "/helm", fields: [{ label: "page", value: "helm charts releases" }] },
  { kind: "Page", title: "Certificates", href: "/certificates", fields: [{ label: "page", value: "tls https ssl cert-manager letsencrypt expiry" }] },
  { kind: "Page", title: "Access", href: "/access", fields: [{ label: "page", value: "rbac roles permissions who can secrets" }] },
  { kind: "Page", title: "AI assistant", href: "/assistant", fields: [{ label: "page", value: "ai chat gemini ask question" }] },
  { kind: "Page", title: "FinOps", href: "/finops", fields: [{ label: "page", value: "cost billing invoice spend money finance" }] },
];

export function buildSearchIndex(data: LoadedCluster): SearchEntry[] {
  const out: SearchEntry[] = [...PAGES];
  const { bundle } = data;

  for (const ns of data.namespaces) {
    out.push({ kind: "Namespace", title: ns.name, subtitle: `${ns.pods.total} pod${ns.pods.total === 1 ? "" : "s"}`, href: nsHref(ns.name), fields: uniq(ns.hosts.map((h) => ({ label: "host", value: h }))) });
  }

  for (const n of data.nodes) {
    out.push({
      kind: "Node",
      title: n.name,
      subtitle: [n.instanceType, n.nodePool ? `pool ${n.nodePool}` : ""].filter(Boolean).join(" · "),
      href: `/nodes/${encodeURIComponent(n.name)}`,
      fields: uniq([
        { label: "internal IP", value: n.internalIp ?? "" },
        { label: "external IP", value: n.externalIp ?? "" },
        { label: "size", value: n.instanceType ?? "" },
        { label: "pool", value: n.nodePool ?? "" },
      ]),
    });
  }

  for (const w of buildWorkloads(bundle)) {
    out.push({
      kind: "Workload",
      title: w.name,
      subtitle: `${w.kind} · ${w.namespace}`,
      href: `${nsHref(w.namespace)}?tab=workloads`,
      fields: uniq([...w.images.map((i) => ({ label: "image", value: i })), { label: "Helm release", value: w.helmRelease ?? w.release ?? "" }]),
    });
  }

  for (const r of data.rows) {
    out.push({
      kind: "Pod",
      title: r.name,
      subtitle: `${r.status} · ${r.namespace}`,
      href: `${nsHref(r.namespace)}/pods/${encodeURIComponent(r.name)}`,
      fields: uniq([
        { label: "IP", value: r.podIp ?? "" },
        ...r.images.map((i) => ({ label: "image", value: i })),
        { label: "commit", value: r.commit ?? "" },
        { label: "Helm release", value: r.release ?? "" },
        { label: "node", value: r.nodeName ?? "" },
      ]),
    });
  }

  for (const s of buildServiceViews(bundle)) {
    out.push({
      kind: "Service",
      title: s.name,
      subtitle: `${s.type} · ${s.namespace}`,
      href: `${nsHref(s.namespace)}?tab=network`,
      fields: uniq([{ label: "cluster IP", value: s.clusterIp && s.clusterIp !== "None" ? s.clusterIp : "" }, ...s.loadBalancer.map((ip) => ({ label: "public IP", value: ip })), ...s.externalIps.map((ip) => ({ label: "external IP", value: ip }))]),
    });
  }

  for (const i of buildIngressViews(bundle)) {
    out.push({
      kind: "Ingress",
      title: i.name,
      subtitle: i.namespace,
      href: `${nsHref(i.namespace)}?tab=network`,
      fields: uniq([...i.hosts.map((h) => ({ label: "host", value: h })), ...i.address.map((a) => ({ label: "address", value: a }))]),
    });
  }

  for (const p of buildPvcViews(bundle)) {
    out.push({ kind: "Volume", title: p.name, subtitle: `${p.status} · ${p.namespace}`, href: `${nsHref(p.namespace)}?tab=storage`, fields: uniq([{ label: "volume", value: p.volumeName ?? "" }]) });
  }

  for (const h of data.helm.releases) {
    out.push({
      kind: "Helm release",
      title: h.name,
      subtitle: `${h.namespace}${h.revision ? ` · revision ${h.revision}` : ""}`,
      href: `/helm/${encodeURIComponent(h.namespace)}/${encodeURIComponent(h.name)}`,
      fields: uniq([...h.images.map((i) => ({ label: "image", value: i })), ...h.commits.map((c) => ({ label: "commit", value: c }))]),
    });
  }

  if (data.certificates.state === "ok") {
    for (const c of data.certificates.certificates) {
      out.push({ kind: "Certificate", title: c.name, subtitle: `${c.namespace} · ${c.state}`, href: "/certificates", fields: uniq(c.dnsNames.map((d) => ({ label: "host", value: d }))) });
    }
  }

  return out;
}
