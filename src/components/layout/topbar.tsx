import { Activity, Cloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { selectedCluster } from "@/lib/clusters/registry";
import { getRefreshSeconds } from "@/lib/config";
import { loadCluster } from "@/lib/data";
import { buildSearchIndex, PAGES } from "@/lib/search";
import { PROVIDER_LABEL } from "@/lib/providers/detect";
import { AutoRefresh } from "./auto-refresh";
import { ClusterSwitcher } from "./cluster-switcher";
import { GlobalSearch } from "./global-search";
import { ThemeToggle } from "./theme-toggle";

export async function Topbar() {
  const [data, selected] = await Promise.all([loadCluster(), selectedCluster()]);
  const { connection } = data;
  // Everything searchable, built from what this request already loaded. Without a cluster, the pages still are.
  const index = data.ok ? buildSearchIndex(data) : PAGES;
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/85 px-6 py-3 backdrop-blur">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${connection.reachable ? "bg-success" : "bg-danger"}`} aria-hidden />
          <span className="text-sm font-medium">{connection.reachable ? "Connected" : "Not connected"}</span>
        </span>
        <ClusterSwitcher clusters={selected?.all ?? []} selected={selected?.summary.id} />
        {connection.version ? <Badge>{connection.version}</Badge> : null}
        {connection.provider && connection.provider !== "kubernetes" ? (
          <Badge>
            <Cloud className="size-3" />
            {PROVIDER_LABEL[connection.provider]}{connection.region ? ` · ${connection.region}` : ""}
          </Badge>
        ) : null}
        <Badge tone="info"><Activity className="size-3" /> Live</Badge>
        {connection.reachable && !connection.metricsAvailable ? <Badge tone="warning" title="metrics-server did not answer, so CPU and memory usage are hidden">No metrics</Badge> : null}
      </div>
      <div className="flex items-center gap-3">
        <GlobalSearch index={index} />
        <AutoRefresh defaultSeconds={getRefreshSeconds()} />
        <ThemeToggle />
      </div>
    </header>
  );
}
