import "server-only";
import { fetch } from "undici";
import { HttpMethod, RequestContext, type KubeConfig } from "@kubernetes/client-node";
import { parseHelmSecretList, type HelmRevisionRaw } from "@/lib/helm/parse";

export type HelmRevisionsResult = { state: "ok"; revisions: HelmRevisionRaw[] } | { state: "error"; message: string };

// Ask for metadata only. Kubernetes then answers with names and labels and leaves out the Secret data, so the
// packed release payload (chart, deploy values) is never fetched. There is deliberately no fallback to a full
// response: a server that cannot do this gets an error, not the Secrets.
const METADATA_ONLY = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1";
const MAX_BYTES = 5_000_000;

function failure(status: number): string {
  if (status === 403) return "Not allowed to list Secrets (this is used only to read Helm's release labels). Releases are still listed from the workloads, without revision and status.";
  if (status === 406) return "This Kubernetes version cannot return Secret metadata only, so Helm revisions are not shown (Secret contents are never read).";
  return `Kubernetes answered ${status} when asked for the Helm release labels.`;
}

/**
 * Reads the labels of Helm's release Secrets: one read-only request,
 *   GET /api/v1/secrets?labelSelector=owner=helm   (metadata only)
 * Never throws.
 */
export async function loadHelmRevisions(kc: KubeConfig, timeoutMs = 10_000): Promise<HelmRevisionsResult> {
  try {
    const cluster = kc.getCurrentCluster();
    if (!cluster) return { state: "error", message: "No active cluster in the kubeconfig." };

    const url = new URL(`${cluster.server.replace(/\/$/, "")}/api/v1/secrets`);
    url.searchParams.set("labelSelector", "owner=helm");

    const context = new RequestContext(url.toString(), HttpMethod.GET);
    await kc.applySecurityAuthentication(context);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { ...(context.getHeaders() as Record<string, string>), Accept: METADATA_ONLY },
      dispatcher: context.getDispatcher() as never,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) return { state: "error", message: failure(response.status) };

    const text = await response.text();
    if (text.length > MAX_BYTES) return { state: "error", message: "The Helm release list was unexpectedly large and was ignored." };
    const parsed = parseHelmSecretList(JSON.parse(text));
    return parsed.ok ? { state: "ok", revisions: parsed.revisions } : { state: "error", message: parsed.message };
  } catch (error) {
    return { state: "error", message: `Could not read the Helm release labels: ${error instanceof Error ? error.message : String(error)}` };
  }
}
