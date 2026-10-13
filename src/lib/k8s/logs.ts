import "server-only";
import { fetch } from "undici";
import { HttpMethod, RequestContext, type KubeConfig } from "@kubernetes/client-node";
import type { OpenLogBody } from "@/lib/logs/stream-core";

/**
 * The only place the dashboard reads pod logs. One read-only request:
 *   GET /api/v1/namespaces/<ns>/pods/<pod>/log
 * This is written against the HTTP client directly instead of the library's log helper, because that
 * helper leaves an unhandled AbortError behind when a stream is stopped, which would crash the server.
 */
export interface PodLogRequest {
  namespace: string;
  pod: string;
  container: string;
  tailLines?: number;
  /** Logs of the previous (crashed) container instance. Ends instead of following. */
  previous?: boolean;
  /** RFC3339 time to resume from after a dropped connection. */
  sinceTime?: string;
}

export class LogRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LogRequestError";
  }
}

async function failureMessage(status: number, response: { text(): Promise<string> }): Promise<string> {
  let detail = "";
  try {
    const text = (await response.text()).slice(0, 4_000);
    detail = (JSON.parse(text) as { message?: string }).message ?? "";
  } catch {
    /* not JSON; ignore */
  }
  if (status === 403) return "Not allowed to read logs for this pod (the kubeconfig needs the pods/log permission).";
  if (status === 404) return "Pod or container not found. It may have been replaced; open the new pod.";
  if (detail) return detail;
  if (status === 400) return "Kubernetes would not return logs for this container (it may still be starting, or has no previous run).";
  return `Kubernetes answered ${status} for the log request.`;
}

export function openPodLog(request: PodLogRequest, kc: KubeConfig): OpenLogBody {
  return async (signal) => {
    const cluster = kc.getCurrentCluster();
    if (!cluster) throw new Error("No active cluster in the kubeconfig.");

    const url = new URL(`${cluster.server.replace(/\/$/, "")}/api/v1/namespaces/${encodeURIComponent(request.namespace)}/pods/${encodeURIComponent(request.pod)}/log`);
    url.searchParams.set("container", request.container);
    url.searchParams.set("follow", request.previous ? "false" : "true");
    url.searchParams.set("timestamps", "true");
    url.searchParams.set("previous", request.previous ? "true" : "false");
    if (request.sinceTime) url.searchParams.set("sinceTime", request.sinceTime);
    else if (request.tailLines) url.searchParams.set("tailLines", String(request.tailLines));

    const context = new RequestContext(url.toString(), HttpMethod.GET);
    await kc.applySecurityAuthentication(context);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: context.getHeaders() as never,
      dispatcher: context.getDispatcher() as never,
      signal,
    });
    if (response.status !== 200 || !response.body) {
      throw new LogRequestError(response.status, await failureMessage(response.status, response));
    }
    return response.body as unknown as ReadableStream<Uint8Array>;
  };
}
