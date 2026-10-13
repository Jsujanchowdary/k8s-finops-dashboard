// Turning what the Kubernetes client throws into a sentence someone can act on. Pure, so it is tested.

/** The HTTP status of a Kubernetes API error (ApiException has `code`), if there is one. */
export function statusOf(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

function textOf(error: unknown): string {
  const parts: string[] = [];
  let e: unknown = error;
  for (let i = 0; e && i < 4; i += 1) {
    const o = e as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof o.message === "string") parts.push(o.message);
    if (typeof o.code === "string") parts.push(o.code);
    e = o.cause;
  }
  return parts.length ? parts.join(" ") : String(error);
}

/** Why a connection to an API server failed, without echoing anything secret. */
export function describeConnectionError(error: unknown): string {
  const status = statusOf(error);
  if (status === 401) return "The cluster refused the credentials (401). The token is wrong, expired, or belongs to another cluster.";
  if (status === 403) return "The credentials work but are not allowed to read this (403). Apply deploy/read-only-rbac.yaml and use that ServiceAccount's token.";
  if (status !== undefined) return `The API server answered with an error (${status}).`;
  const text = textOf(error);
  if (/self[- ]signed|unable to verify|UNABLE_TO_GET_ISSUER|DEPTH_ZERO|CERT_UNTRUSTED|unable to get local issuer/i.test(text)) {
    return "The API server's certificate is not signed by the CA certificate you gave. Check that the CA belongs to this cluster.";
  }
  if (/altnames|ERR_TLS_CERT_ALTNAME|does not match certificate/i.test(text)) return "The API server's certificate is for a different address. Check the API server URL.";
  if (/expired|CERT_HAS_EXPIRED/i.test(text)) return "The API server's certificate (or the client certificate) has expired.";
  const missing = text.match(/ENOENT[^']*'([^']+)'/);
  if (missing) return `This kubeconfig context points to a file that does not exist: ${missing[1]}. Fix the path in the kubeconfig, or remove the context.`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return "That API server address could not be found (DNS). Check the URL.";
  if (/ECONNREFUSED/i.test(text)) return "The API server refused the connection. Check the URL and port.";
  if (/timed out|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|aborted/i.test(text)) return "The API server did not answer in time. It may be private (only reachable from inside its network) or behind a firewall.";
  if (/ECONNRESET|socket hang up/i.test(text)) return "The connection to the API server was cut off.";
  return `Could not connect: ${text.slice(0, 300)}`;
}
