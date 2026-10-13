// Validation for the log endpoint. Names are checked against Kubernetes' own naming rules so that
// nothing odd can be placed into the request path sent to the cluster.

const POD_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
const CONTAINER_NAME = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export const TAIL_OPTIONS = [100, 200, 500, 1000] as const;
const MAX_TAIL = 2000;

export interface LogParams {
  namespace: string;
  pod: string;
  container: string;
  tailLines: number;
  previous: boolean;
  sinceTime?: string;
}

export function parseLogParams(namespace: string, pod: string, search: URLSearchParams): { ok: true; value: LogParams } | { ok: false; error: string } {
  if (!POD_NAME.test(namespace)) return { ok: false, error: "Invalid namespace." };
  if (!POD_NAME.test(pod)) return { ok: false, error: "Invalid pod name." };
  const container = search.get("container") ?? "";
  if (!CONTAINER_NAME.test(container)) return { ok: false, error: "Invalid or missing container name." };

  const tailRaw = search.get("tail");
  let tailLines = 200;
  if (tailRaw !== null) {
    if (!/^\d{1,5}$/.test(tailRaw)) return { ok: false, error: "tail must be a whole number." };
    tailLines = Number(tailRaw);
    if (tailLines < 1 || tailLines > MAX_TAIL) return { ok: false, error: `tail must be between 1 and ${MAX_TAIL}.` };
  }

  const since = search.get("since");
  if (since !== null && !RFC3339.test(since)) return { ok: false, error: "since must be an RFC3339 timestamp." };

  const previous = search.get("previous") === "1" || search.get("previous") === "true";
  return { ok: true, value: { namespace, pod, container, tailLines, previous, sinceTime: since ?? undefined } };
}

/**
 * This dashboard is for the machine it runs on. Reject requests whose Host is not local, and
 * cross-site requests (DNS rebinding or another web page trying to read the stream).
 */
export function isLocalRequest(headers: { get(name: string): string | null }): boolean {
  const host = headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) return false;
  const origin = headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}
