import "server-only";
import { getSetting } from "@/lib/settings/store";
import { clusterIdFromServer, parseNodePools, statusMessage, type NodePoolsResult } from "./node-pools-core";

/**
 * The only DigitalOcean API call the dashboard makes:
 *   GET /v2/kubernetes/clusters/<cluster-id>/node_pools
 * It is read-only, uses a token that stays on the server, and touches nothing outside this cluster
 * (no Droplets, no other resources).
 */
export async function fetchNodePools(options: { baseUrl: string; token: string; clusterId: string; timeoutMs?: number }): Promise<NodePoolsResult> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/v2/kubernetes/clusters/${encodeURIComponent(options.clusterId)}/node_pools`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      cache: "no-store",
    });
    if (!response.ok) return { state: "error", message: statusMessage(response.status) };
    return { state: "ok", pools: parseNodePools(await response.json()) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { state: "error", message: `Could not reach the DigitalOcean API: ${reason}` };
  }
}

// A short cache keeps a fast auto-refresh from hammering DigitalOcean (the limit is 250 requests a minute).
const OK_TTL_MS = 30_000;
const ERROR_TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: NodePoolsResult }>();

/** After the token changes, the next page load asks DigitalOcean again. */
export function forgetNodePools(): void {
  cache.clear();
}

/** Node pools for the cluster behind `server`, or a state explaining why they are not available. Never throws. */
export async function loadNodePools(server: string): Promise<NodePoolsResult> {
  const token = getSetting("DIGITALOCEAN_TOKEN");
  if (!token) return { state: "no-token" };
  const clusterId = clusterIdFromServer(server);
  if (!clusterId) return { state: "not-doks" };

  const hit = cache.get(clusterId);
  if (hit && Date.now() - hit.at < (hit.value.state === "ok" ? OK_TTL_MS : ERROR_TTL_MS)) return hit.value;

  const value = await fetchNodePools({ baseUrl: process.env.DIGITALOCEAN_API_URL ?? "https://api.digitalocean.com", token, clusterId });
  cache.set(clusterId, { at: Date.now(), value });
  return value;
}
