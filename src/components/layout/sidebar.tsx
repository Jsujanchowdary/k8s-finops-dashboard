import { Lock, Boxes } from "lucide-react";
import { loadCluster } from "@/lib/data";
import { SidebarNav } from "./sidebar-nav";

export async function Sidebar() {
  const data = await loadCluster();
  const namespaces = data.ok
    ? data.namespaces.map((n) => ({ name: n.name, health: n.health, pods: n.pods.total, attention: n.pods.unhealthy }))
    : [];
  const nodeNames = data.ok ? data.nodes.map((n) => n.name) : [];
  const helmCount = data.ok ? data.helm.releases.length : 0;
  const certs = data.ok && data.certificates.state === "ok" ? data.certificates.certificates : null;
  const certificates = certs ? { count: certs.length, attention: certs.filter((c) => c.health === "critical" || c.health === "warning").length } : null;
  // App ServiceAccounts that could take over the cluster (admin or can grant access). People and system are expected.
  const riskyApps = data.ok && data.access.state === "ok" ? data.access.report.subjects.filter((s) => s.category === "apps" && s.severity === "critical").length : 0;
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-5 border-r border-border bg-surface px-3 py-4 md:flex">
      <div className="flex items-center gap-2 px-1">
        <span className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent">
          <Boxes className="size-4" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold">DO Dashboard</p>
          <p className="text-xs text-muted">Kubernetes explorer</p>
        </div>
      </div>
      <SidebarNav namespaces={namespaces} nodeNames={nodeNames} helmCount={helmCount} certificates={certificates} riskyApps={riskyApps} />
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-xs text-muted">
        <Lock className="size-3.5 shrink-0" />
        <span>Read-only. Nothing here can change the cluster.</span>
      </div>
    </aside>
  );
}
