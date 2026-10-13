// Builds the Helm release list. The workloads Helm created (found through the release annotation) give the
// base list; the revision labels from Helm's release Secrets add revision, status and last-updated when they
// are available. Pure functions, no network.
import type { Health, HelmReleaseView, PodRow, WorkloadView } from "@/lib/k8s/types";
import type { HelmRevisionRaw } from "./parse";

const SEVERITY: Record<Health, number> = { critical: 3, warning: 2, unknown: 1, healthy: 0 };
const worse = (a: Health, b: Health): Health => (SEVERITY[b] > SEVERITY[a] ? b : a);

function statusHealth(status: string | undefined): Health | undefined {
  if (!status) return undefined;
  if (status === "failed") return "critical";
  if (status.startsWith("pending") || status === "uninstalling") return "warning";
  return undefined;
}

const key = (namespace: string, name: string) => `${namespace}/${name}`;

export function buildHelmReleases(revisions: HelmRevisionRaw[] | null, workloads: WorkloadView[], rows: PodRow[]): HelmReleaseView[] {
  const releases = new Map<string, HelmReleaseView>();
  const ensure = (namespace: string, name: string): HelmReleaseView => {
    const k = key(namespace, name);
    let release = releases.get(k);
    if (!release) {
      release = { name, namespace, revisions: [], workloads: [], pods: { total: 0, ready: 0, unhealthy: 0 }, images: [], commits: [], health: "unknown" };
      releases.set(k, release);
    }
    return release;
  };

  for (const rev of revisions ?? []) ensure(rev.namespace, rev.release).revisions.push({ revision: rev.revision, status: rev.status, updatedAt: rev.updatedAt });

  const workloadRelease = new Map<string, string>(); // namespace/workload name -> namespace/release name
  for (const w of workloads) {
    if (!w.helmRelease) continue;
    ensure(w.namespace, w.helmRelease).workloads.push(w);
    workloadRelease.set(key(w.namespace, w.name), key(w.namespace, w.helmRelease));
  }

  for (const row of rows) {
    const owner = row.owner ? workloadRelease.get(key(row.namespace, row.owner.name)) : undefined;
    const release = owner ? releases.get(owner) : undefined;
    if (!release) continue;
    release.pods.total += 1;
    const [ready, total] = row.ready.split("/");
    if (row.phase === "Running" && ready === total) release.pods.ready += 1;
    if (row.health === "critical" || row.health === "warning") release.pods.unhealthy += 1;
    if (row.commit && !release.commits.includes(row.commit)) release.commits.push(row.commit);
  }

  const result: HelmReleaseView[] = [];
  for (const release of releases.values()) {
    release.revisions.sort((a, b) => b.revision - a.revision);
    const current = release.revisions[0];
    if (current) {
      release.revision = current.revision;
      release.status = current.status;
      release.updatedAt = current.updatedAt;
    }
    // `helm list` hides uninstalled releases; so does this.
    if (release.status === "uninstalled" && release.workloads.length === 0) continue;

    release.images = [...new Set(release.workloads.flatMap((w) => w.images))];
    let health: Health = release.workloads.reduce<Health>((acc, w) => worse(acc, w.health), release.workloads.length ? "healthy" : "unknown");
    if (release.pods.unhealthy > 0) health = worse(health, "warning");
    const fromStatus = statusHealth(release.status);
    if (fromStatus) health = worse(health, fromStatus);
    release.health = health;
    result.push(release);
  }
  return result.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}
