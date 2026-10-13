// Node pool information from the DigitalOcean API (autoscaling settings live there, not in Kubernetes).
// Pure parsing, no network, so it can be tested directly.

export interface NodePoolView {
  id: string;
  name: string;
  size: string;
  /** Nodes DigitalOcean currently says the pool has. */
  count: number;
  autoScale: boolean;
  /** Only present when autoscaling is on. DigitalOcean can leave stale values behind after it is turned off. */
  minNodes?: number;
  maxNodes?: number;
  nodeNames: string[];
}

export type NodePoolsResult =
  | { state: "ok"; pools: NodePoolView[] }
  | { state: "no-token" }
  | { state: "not-doks" }
  | { state: "error"; message: string };

const CLUSTER_HOST = /^https:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.k8s\.ondigitalocean\.com/i;

/** DOKS API servers are named <cluster-id>.k8s.ondigitalocean.com. */
export function clusterIdFromServer(server: string): string | undefined {
  return CLUSTER_HOST.exec(server)?.[1].toLowerCase();
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

export function parseNodePools(body: unknown): NodePoolView[] {
  const pools = (body as { node_pools?: unknown })?.node_pools;
  if (!Array.isArray(pools)) return [];
  return pools.map((raw): NodePoolView => {
    const p = raw as Record<string, unknown>;
    const autoScale = p.auto_scale === true;
    const nodes = Array.isArray(p.nodes) ? (p.nodes as Record<string, unknown>[]) : [];
    return {
      id: str(p.id),
      name: str(p.name),
      size: str(p.size),
      count: num(p.count) ?? nodes.length,
      autoScale,
      minNodes: autoScale ? num(p.min_nodes) : undefined,
      maxNodes: autoScale ? num(p.max_nodes) : undefined,
      nodeNames: nodes.map((n) => str(n.name)).filter(Boolean),
    };
  });
}

export function statusMessage(status: number): string {
  if (status === 401) return "DigitalOcean rejected the token. Check DIGITALOCEAN_TOKEN in .env.local.";
  if (status === 403) return "The token is not allowed to read Kubernetes clusters. Create it with the Kubernetes read scope.";
  if (status === 404) return "DigitalOcean does not show this cluster to that token's team.";
  if (status === 429) return "DigitalOcean's rate limit was reached. It will retry shortly.";
  return `DigitalOcean answered ${status} when asked for the node pools.`;
}
